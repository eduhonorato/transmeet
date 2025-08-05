import os
import sys
import json
import io
from openai import OpenAI
from google import genai
from google.genai import types
from dotenv import load_dotenv
from qdrant_client import QdrantClient

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

load_dotenv(os.path.join(os.path.dirname(__file__), '..', '.env'))

QDRANT_HOST = "localhost"
QDRANT_PORT = 6333
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")

EMBEDDING_MODEL = "text-embedding-3-small"
ROUTING_MODEL = "gpt-4o-mini"
GEMINI_LLM_MODEL = "gemini-2.0-flash"
OPENAI_LLM_MODEL = "gpt-4o-mini"

try:
    if not OPENAI_API_KEY:
        raise ValueError("A variável de ambiente OPENAI_API_KEY não foi definida.")
    openai_client = OpenAI(api_key=OPENAI_API_KEY)
    qdrant_client = QdrantClient(host=QDRANT_HOST, port=QDRANT_PORT)

    if not GEMINI_API_KEY:
        raise ValueError("A variável de ambiente GEMINI_API_KEY não foi definida.")
    gemini_client = genai.Client(api_key=GEMINI_API_KEY)

except Exception as e:
    print(f"ERRO: Falha ao inicializar os clientes ou configurar as APIs: {e}", file=sys.stderr)
    sys.exit(1)


def get_repo_configs():
    config_path = os.path.join(os.path.dirname(__file__), '..', 'repos.json')
    try:
        with open(config_path, 'r', encoding='utf-8') as f:
            return json.load(f).get('repositories', [])
    except (FileNotFoundError, json.JSONDecodeError) as e:
        print(f"ERRO: Não foi possível carregar ou decodificar o repos.json: {e}", file=sys.stderr)
        return []

def route_question(question, repo_configs):
    if not repo_configs:
        return None
    options_str = "\n".join(
        f"- `{config['qdrant_collection']}`: Para perguntas sobre o repositório '{config['name']}' ({config['github_repo']})."
        for config in repo_configs
    )
    system_prompt = f"""
        Você é um especialista em roteamento de perguntas. Sua tarefa é determinar a base de conhecimento mais relevante para a pergunta de um usuário.
        As bases de conhecimento disponíveis são:
        {options_str}
        - `none`: Se a pergunta não parece relacionada a nenhuma das opções fornecidas.

        Com base na pergunta do usuário, responda APENAS com o nome da base de conhecimento mais apropriada (por exemplo, `kb_ventura_back`, `none`). Não adicione nenhum outro texto.
    """
    try:
        response = openai_client.chat.completions.create(
            model=ROUTING_MODEL,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": question}
            ],
            temperature=0.0
        )
        return response.choices[0].message.content.strip()
    except Exception as e:
        print(f"ERRO: Falha ao rotear a pergunta com o LLM: {e}", file=sys.stderr)
        return None

def get_embedding(text):
    try:
        response = openai_client.embeddings.create(input=[text], model=EMBEDDING_MODEL)
        return response.data[0].embedding
    except Exception as e:
        print(f"ERRO: Falha ao gerar embedding: {e}", file=sys.stderr)
        sys.exit(1)

def search_qdrant(collection_name, query_embedding, limit=7):
    try:
        return qdrant_client.search(
            collection_name=collection_name,
            query_vector=query_embedding,
            limit=limit,
            with_payload=True
        )
    except Exception as e:
        print(f"AVISO: Não foi possível buscar na coleção '{collection_name}'. Ela pode não existir. Erro: {e}")
        return []

def format_context(search_results):
    if not search_results:
        return "Nenhum contexto relevante encontrado na base de conhecimento."
    contexts = []
    for result in search_results:
        payload = result.payload
        source = payload.get('source', 'desconhecida')
        score = result.score
        context_header = f"--- Contexto de {source} (Score: {score:.2f}) ---"
        if source == 'github':
            file_path = payload.get('file_path', 'arquivo_desconhecido')
            code_snippet = payload.get('code', '')
            contexts.append(f"{context_header}\nArquivo: {file_path}\n```\n{code_snippet}\n```")
        elif source == 'meeting':
            file_name = payload.get('file_name', 'reuniao_desconhecida')
            text_snippet = payload.get('text', '')
            contexts.append(f"{context_header}\nFonte: {file_name}\n{text_snippet}")
    return "\n\n".join(contexts)


def main():
    if len(sys.argv) < 2:
        print("ERRO: Nenhuma pergunta fornecida.", file=sys.stderr)
        sys.exit(1)
    question = " ".join(sys.argv[1:]).strip()
    conversation_history = sys.stdin.read().strip()

    print(f"Pergunta: {question}\n", file=sys.stderr)
    if conversation_history:
        print(f"INFO: Histórico da conversa recebido:\n---\n{conversation_history}\n---", file=sys.stderr)

    repo_configs = get_repo_configs()
    if not repo_configs:
        print("AVISO: Nenhum repositório configurado em repos.json.", file=sys.stderr)

    print("INFO: Camada 1: Roteando a pergunta para a base de conhecimento apropriada...", file=sys.stderr)
    chosen_collection = route_question(question, repo_configs)

    search_results = []
    question_embedding = get_embedding(question)

    if chosen_collection and chosen_collection != 'none':
        print(f"INFO: Roteador selecionou a coleção: '{chosen_collection}'", file=sys.stderr)
        print("INFO: Buscando por contexto relevante...", file=sys.stderr)
        search_results = search_qdrant(chosen_collection, question_embedding)
    else:
        print("\nINFO: O roteador não encontrou uma base específica. Ativando Camada 2: Busca Profunda.", file=sys.stderr)
        collections_to_search = [config['qdrant_collection'] for config in repo_configs]
        collections_to_search.append("transmeet_meetings")
        unique_collections = list(set(collections_to_search))
        print(f"INFO: Buscando em TODAS as bases de conhecimento: {unique_collections}", file=sys.stderr)
        all_results = []
        for collection_name in unique_collections:
            print(f"INFO: Buscando na coleção '{collection_name}'...", file=sys.stderr)
            results = search_qdrant(collection_name, question_embedding, limit=5)
            all_results.extend(results)
        if all_results:
            all_results.sort(key=lambda x: x.score, reverse=True)
            search_results = all_results[:10]

    rag_context_string = format_context(search_results)

    system_prompt = "Você é um desenvolvedor de software sênior. Responda à pergunta do usuário com base no contexto fornecido, que pode incluir um histórico de conversas, trechos de código relevantes e/ou trechos de transcrições de reuniões. Seja conciso, preciso e sintetize as informações de todas as fontes fornecidas."
    
    # system_prompt = """
    #     Você é um desenvolvedor de software sênior e um assistente de IA. Sua tarefa é responder direta e objetivamente à pergunta do usuário.
    #     Use o contexto fornecido (histórico da conversa, código, atas de reunião) APENAS como base para formular sua resposta final.
    #     REGRAS IMPORTANTES:
    #     1.  Vá direto ao ponto.
    #     2.  NÃO faça resumos, introduções ou preâmbulos.
    #     3.  NÃO repita o contexto ou a pergunta na sua resposta.
    #     4.  Responda apenas o que foi perguntado.
    # """

    context_for_prompt = f"""
        # Histórico da Conversa Anterior
        {conversation_history if conversation_history else "Nenhum histórico de conversa anterior."}

        # Contexto da Base de Conhecimento (Código e Reuniões)
        {rag_context_string}
    """

    final_user_prompt = f"""
        Com base estritamente no contexto fornecido abaixo, responda à minha pergunta.

        --- INÍCIO DO CONTEXTO ---
        {context_for_prompt}
        --- FIM DO CONTEXTO ---

        PERGUNTA FINAL: {question}
    """

    # user_prompt = f"""
    #     # Histórico da Conversa
    #     {conversation_history if conversation_history else "Nenhum histórico de conversa anterior."}

    #     # Contexto da Base de Conhecimento (Código e Reuniões)
    #     {rag_context_string}

    #     # Nova Pergunta
    #     Com base em TODO o contexto acima, responda à seguinte pergunta: **{question}**
    # """

    answer = ""
    try:
        print("\nINFO: Enviando requisição para o Google Gemini...", file=sys.stderr)
        response = gemini_client.models.generate_content(
            model=GEMINI_LLM_MODEL,
            config=types.GenerateContentConfig(
                system_instruction=system_prompt,
                temperature=0.4
            ),
            contents=final_user_prompt,
        )
        answer = response.text.strip()
        # print("\n--- MODEL (via Gemini) ---\n")

    except Exception as e_gemini:
        print(f"\nAVISO: Falha ao usar a API do Gemini. Erro: {e_gemini}", file=sys.stderr)
        print("INFO: Acionando fallback para a API da OpenAI...", file=sys.stderr)

        try:
            messages_for_openai = [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": final_user_prompt}
            ]
            response = openai_client.chat.completions.create(
                model=OPENAI_LLM_MODEL,
                messages=messages_for_openai,
                temperature=0.1
            )
            answer = response.choices[0].message.content.strip()
            # print("\n--- RESPOSTA (via OpenAI Fallback) ---\n")

        except Exception as e_openai:
            print(f"\nERRO: Falha crítica. A API de fallback da OpenAI também falhou. Erro: {e_openai}", file=sys.stderr)
            sys.exit(1)
            
    if answer:
        print(answer)
    else:
        print("\nERRO: Não foi possível obter uma resposta de nenhum serviço de LLM.", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
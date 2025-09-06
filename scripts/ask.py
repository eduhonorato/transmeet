import os
import sys
import json
import io
from openai import OpenAI
from google import genai
from google.genai import types
from dotenv import load_dotenv
from qdrant_client import QdrantClient

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from config import *

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

load_dotenv(os.path.join(os.path.dirname(__file__), '..', '.env'))

QDRANT_HOST = "localhost"
QDRANT_PORT = 6333
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")

try:
    if not OPENAI_API_KEY:
        raise ValueError("A variável de ambiente OPENAI_API_KEY não foi definida.")
    qdrant_client = QdrantClient(host=QDRANT_HOST, port=QDRANT_PORT)

    if not GEMINI_API_KEY:
        raise ValueError("A variável de ambiente GEMINI_API_KEY não foi definida.")
    gemini_client = genai.Client(api_key=GEMINI_API_KEY)

except Exception as e:
    print(json.dumps({"type": "ERROR", "payload": f"Falha ao inicializar clientes: {e}"}), flush=True)
    sys.exit(1)

def send_event(event_type, payload):
    print(json.dumps({"type": event_type, "payload": payload}), flush=True)

def get_repo_configs():
    config_path = os.path.join(os.path.dirname(__file__), '..', 'repos.json')
    try:
        with open(config_path, 'r', encoding='utf-8') as f:
            return json.load(f).get('repositories', [])
    except (FileNotFoundError, json.JSONDecodeError) as e:
        send_event(f"ERRO: Não foi possível carregar ou decodificar o repos.json: {e}", {e})
        return []

def route_question(question, repo_configs):
    if not repo_configs:
        return None
    options_str = "\n".join(
        f"- `{config['qdrant_collection']}`: Para perguntas sobre o repositório '{config['name']}' ({config['github_repo']})."
        for config in repo_configs
    )
    system_prompt = f"""
        Você é um especialista em roteamento de perguntas para uma base de conhecimento de uma empresa de software. Sua tarefa é determinar a base mais relevante para a pergunta de um usuário.

        As bases de conhecimento disponíveis são:
        {options_str}
        - `transmeet_meetings_local`: Para perguntas sobre o que foi discutido em reuniões, decisões tomadas, ou tópicos abordados. Ex: "o que foi falado na reunião sobre o projeto X?".
        - `geral`: Para perguntas gerais sobre programação, tecnologia, ou qualquer outro tópico que não seja específico dos repositórios ou reuniões listados.

        Com base na pergunta do usuário, responda APENAS com o nome da base de conhecimento mais apropriada (ex: `kb_ventura_back`, `transmeet_meetings_local`, `geral`). Não adicione nenhum outro texto.
    """

    messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": question},
    ]

    try:
        response = client.chat.completions.create(
            model=ROUTING_MODEL,
            messages=messages
        )

        choice = response.choices[0].message.content.strip()
        if choice == 'none': choice = 'geral'
        print(f"Roteamento escolhido pelo LLM: {choice}", file=sys.stderr)
        return choice

    except Exception as e:
        send_event(f"ERRO: Falha ao rotear a pergunta com o LLM: {e}")
        return None

def get_embedding(text):
    try:
        response = client.embeddings.create(input=[text], model=EMBEDDING_MODEL)
        return response.data[0].embedding
    except Exception as e:
        send_event(f"ERRO: Falha ao gerar embedding: {e}")
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
        send_event(f"AVISO: Não foi possível buscar na coleção '{collection_name}'. Ela pode não existir. Erro: {e}")
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

    # if chosen_collection and chosen_collection != 'none':
    #     print(f"INFO: Roteador selecionou a coleção: '{chosen_collection}'", file=sys.stderr)
    #     print("INFO: Buscando por contexto relevante...", file=sys.stderr)
    #     search_results = search_qdrant(chosen_collection, question_embedding)
    # else:
    #     print("\nINFO: O roteador não encontrou uma base específica. Ativando Camada 2: Busca Profunda.", file=sys.stderr)
    #     collections_to_search = [config['qdrant_collection'] for config in repo_configs]
    #     collections_to_search.append("transmeet_meetings_local")
    #     unique_collections = list(set(collections_to_search))
    #     print(f"INFO: Buscando em TODAS as bases de conhecimento: {unique_collections}", file=sys.stderr)
    #     all_results = []
    #     for collection_name in unique_collections:
    #         print(f"INFO: Buscando na coleção '{collection_name}'...", file=sys.stderr)
    #         results = search_qdrant(collection_name, question_embedding, limit=5)
    #         all_results.extend(results)
    #     if all_results:
    #         all_results.sort(key=lambda x: x.score, reverse=True)
    #         search_results = all_results[:10]

    if chosen_collection and chosen_collection != 'geral':
        print(f"INFO: Roteador selecionou a coleção: '{chosen_collection}'", file=sys.stderr)
        print("INFO: Buscando por contexto relevante...", file=sys.stderr)
        question_embedding = get_embedding(question)
        search_results = search_qdrant(chosen_collection, question_embedding)
        rag_context_string = format_context(search_results)
    else:
        print("\nINFO: O roteador classificou a pergunta como 'geral'. A busca na base de conhecimento foi ignorada.", file=sys.stderr)
        rag_context_string = "Nenhum contexto da base de conhecimento foi usado. A resposta será baseada no conhecimento geral do modelo."

    rag_context_string = format_context(search_results)

    system_prompt = "Você é um desenvolvedor de software sênior. Responda à pergunta do usuário com base no contexto fornecido, que pode incluir um histórico de conversas, trechos de código relevantes e/ou trechos de transcrições de reuniões. Seja conciso, preciso e sintetize as informações de todas as fontes fornecidas."
    
    system_prompt = """
        Você é um desenvolvedor de software sênior e um assistente de IA. Sua tarefa é responder direta e objetivamente à pergunta do usuário.
        Use o contexto fornecido (histórico da conversa, código, atas de reunião) APENAS como base para formular sua resposta final.
        REGRAS IMPORTANTES:
        1.  Vá direto ao ponto.
        2.  NÃO faça resumos, introduções ou preâmbulos.
        3.  NÃO repita o contexto ou a pergunta na sua resposta.
        4.  Responda apenas o que foi perguntado.
    """

    context_for_prompt = f"""# Histórico\n{conversation_history if conversation_history else "Nenhum."}\n\n# Contexto da Base de Conhecimento\n{rag_context_string}"""

    final_user_prompt = f"""Use o contexto e seu plano para responder à pergunta final.
        --- CONTEXTO ---
        {context_for_prompt}
        --- FIM DO CONTEXTO ---
        PERGUNTA FINAL: {question}
    """

    messages_for_openai = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": final_user_prompt}
    ]

    try:
        send_event("INFO", "Gerando resposta final...")
        response_stream = client.chat.completions.create(
            model=OPENAI_LLM_MODEL,
            messages=messages_for_openai,
            stream=True
        )

        for chunk in response_stream:
            content = chunk.choices[0].delta.content
        
            if content:
                send_event("ANSWER_STREAM_CHUNK", content)

        send_event("STREAM_END", "Success")

    except Exception as e_openai:
        send_event("ERROR", f"Falha crítica no LLM final: {e_openai}")
        sys.exit(1)

if __name__ == "__main__":
    main()
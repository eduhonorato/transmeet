import os
import glob
from openai import OpenAI
from datetime import datetime
from dotenv import load_dotenv

load_dotenv()

base_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
outputs_dir = os.path.join(base_dir, "files", "outputs")

text_files = sorted(glob.glob(os.path.join(outputs_dir, "output_*.txt")), reverse=True)
if not text_files:
    print("❌ Nenhum output de transcrição encontrado.")
    exit(1)
latest_text = text_files[0]
print(f"📄 Usando transcrição: {latest_text}")

with open(latest_text, "r", encoding="utf-8") as f:
    conversation = f.read()

weekly_date = datetime.now().strftime("%d/%m/%Y")
prompt = f"""
Você é um assistente especializado em gerar atas de reunião. Abaixo está uma transcrição com marcações de tempo e nome dos participantes.

Gere uma ATA clara e estruturada:
- Liste os participantes.
- Organize os tópicos falados por pessoa (ex: "Fulano comentou sobre X...").
- Destaque decisões tomadas e ações atribuídas (ex: "Ciclano ficará responsável por Y").
- Informe também falas que podem agregar valor a nível de "memória de projeto"
- Use uma linguagem formal e objetiva.
- Não precisa enviar "Elaborado por"

Inclua a data da reunião e um título "ATA DA REUNIÃO SEMANAL - DD/MM/AAAA", usando a data de {weekly_date}

Transcrição:
{conversation}
"""

client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))
response = client.chat.completions.create(
    model="gpt-4o-mini",
    messages=[
        {"role": "system", "content": "Você é um assistente que gera atas de reuniões de forma clara, profissional e bem organizada."},
        {"role": "user", "content": prompt}
    ],
    temperature=0.4,
    # max_tokens=1500
)

ata = response.choices[0].message.content

try:
    ata_dir = os.path.join(base_dir, "files", "ata")
    os.makedirs(ata_dir, exist_ok=True)
    timestamp = int(datetime.now().timestamp())
    ata_path = os.path.join(ata_dir, f"ata_reuniao_{timestamp}.txt")
    
    with open(ata_path, "w", encoding="utf-8") as f:
        f.write(ata)
    
    if os.path.exists(ata_path):
        print(f"✅ ATA gerada com sucesso: {ata_path}")
    else:
        print(f"❌ Arquivo de ATA não foi criado: {ata_path}")
        
except Exception as e:
    print(f"❌ Erro ao gerar ATA: {str(e)}")
    import traceback
    traceback.print_exc()
from dotenv import load_dotenv
from openai import OpenAI
import time
import os
import json

load_dotenv()

client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))

m4a_dir = "files/m4aAudios"
m4a_files = sorted([f for f in os.listdir(m4a_dir) if f.endswith(".m4a")], reverse=True)

if not m4a_files:
    print("❌ Nenhum arquivo m4a encontrado!")
    exit(1)

m4a_path = os.path.join(m4a_dir, m4a_files[0])

with open(m4a_path, "rb") as audio_file:
    response = client.audio.transcriptions.create(
        model="whisper-1",
        file=audio_file,
        response_format="verbose_json",
        timestamp_granularities=["segment"]
    )

response_dict = response.model_dump()

timestamp = int(time.time())

os.makedirs("files/json", exist_ok=True)

output_path = f"files/json/transcription_{timestamp}.json"
with open(output_path, "w", encoding="utf-8") as f:
    json.dump(response_dict, f, indent=2, ensure_ascii=False)

print(f"✅ Transcrição salva em: {output_path}")

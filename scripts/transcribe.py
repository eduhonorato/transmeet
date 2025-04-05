from dotenv import load_dotenv
from openai import OpenAI
import time
import os
import json

load_dotenv()

client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))

wav_dir = "files/wavAudios"
wav_files = sorted([f for f in os.listdir(wav_dir) if f.endswith(".wav")], reverse=True)

if not wav_files:
    print("❌ Nenhum arquivo WAV encontrado!")
    exit(1)

wav_path = os.path.join(wav_dir, wav_files[0])

with open(wav_path, "rb") as audio_file:
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

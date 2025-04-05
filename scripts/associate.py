import os
import json
import time
from datetime import datetime
from collections import defaultdict

base_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
logs_dir = os.path.join(base_dir, "files", "logs")
json_dir = os.path.join(base_dir, "files", "json")

json_files = sorted([f for f in os.listdir(json_dir) if f.startswith("transcription_") and f.endswith(".json")], reverse=True)
if not json_files:
    print("❌ Nenhum arquivo de transcrição encontrado!")
    exit(1)
json_path = os.path.join(json_dir, json_files[0])
with open(json_path, "r", encoding="utf-8") as f:
    transcription = json.load(f)
print(f"📄 Usando transcrição: {json_files[0]}")

log_files = sorted([f for f in os.listdir(logs_dir) if f.startswith("log_") and f.endswith(".txt")], reverse=True)
if not log_files:
    print("❌ Nenhum arquivo de log encontrado!")
    exit(1)
log_path = os.path.join(logs_dir, log_files[0])
with open(log_path, "r", encoding="utf-8") as f:
    log_lines = f.readlines()

speaker_windows = []
base_time = None
for line in log_lines:
    if "[START]" in line or "[END]" in line:
        parts = line.strip().split(" - ")
        event_time = parts[0].split(" ")[1]
        username = parts[1].split(" (")[0]
        dt = datetime.fromisoformat(event_time.replace("Z", "+00:00"))
        if not base_time:
            base_time = dt
        seconds = (dt - base_time).total_seconds()
        speaker_windows.append({
            "event": "START" if "[START]" in line else "END",
            "time": seconds,
            "username": username
        })

windows = []
for i in range(0, len(speaker_windows) - 1, 2):
    if speaker_windows[i]["event"] == "START" and speaker_windows[i+1]["event"] == "END":
        windows.append({
            "username": speaker_windows[i]["username"],
            "start": speaker_windows[i]["time"],
            "end": speaker_windows[i+1]["time"]
        })

try:
    output_dir = os.path.join(base_dir, "files", "outputs")
    os.makedirs(output_dir, exist_ok=True)

    timestamp = int(time.time())
    output_path = os.path.join(output_dir, f"output_{timestamp}.txt")
    
    with open(output_path, "w", encoding="utf-8") as f:
        for segment in transcription.get("segments", []):
            start = segment.get("start", 0)
            end = segment.get("end", 0)
            text = segment.get("text", "")
            speaker = "Desconhecido"

            overlaps = defaultdict(float)
            for window in windows:
                overlap_start = max(start, window["start"])
                overlap_end = min(end, window["end"])
                overlap = max(0.0, overlap_end - overlap_start)
                if overlap > 0:
                    overlaps[window["username"]] += overlap

            if overlaps:
                speaker = max(overlaps, key=overlaps.get)
            f.write(f"{speaker}: {text.strip()}\n")
            
    if os.path.exists(output_path):
        print(f"✅ Texto associado salvo em: {output_path}")
    else:
        print(f"❌ Arquivo não foi criado: {output_path}")
        
except Exception as e:
    print(f"❌ Erro ao salvar o arquivo de associação: {str(e)}")
    import traceback
    traceback.print_exc()
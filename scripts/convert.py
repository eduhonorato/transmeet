import os
import sys
import subprocess

MAX_SIZE_MB = 25

if len(sys.argv) < 3:
    print("❌ Uso: python convert_pcm.py <input_pcm_path> <output_m4a_path>")
    exit(1)

input_pcm = sys.argv[1]
output_m4a = sys.argv[2]

sample_rate = 48000
num_channels = 2
sample_format = "s16le"

command = [
    "ffmpeg",
    "-f", sample_format,
    "-ar", str(sample_rate),
    "-ac", str(num_channels),
    "-i", input_pcm,
    "-ac", "1",
    "-ar", "16000",
    "-c:a", "aac",
    "-b:a", "64k",
    "-y",
    output_m4a
]

try:
    subprocess.run(command, check=True)
    print(f"✅ Convertido com sucesso: {output_m4a}")

    size_bytes = os.path.getsize(output_m4a)
    size_mb = size_bytes / (1024 * 1024)

    print(f"📦 Tamanho do arquivo: {size_mb:.2f} MB")
    if size_mb > MAX_SIZE_MB:
        print(f"⚠️ O arquivo ultrapassa os {MAX_SIZE_MB} MB permitidos pela API do Whisper.")
    else:
        print("✅ Arquivo está dentro do limite da API.")
except subprocess.CalledProcessError as e:
    print(f"❌ Erro ao converter com ffmpeg: {e}")
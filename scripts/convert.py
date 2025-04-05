import wave
import os
import sys

if len(sys.argv) < 3:
    print("❌ Uso: python convert.py <input_pcm_path> <output_wav_path>")
    exit(1)

input_file = sys.argv[1]
output_file = sys.argv[2]

sample_rate = 48000
num_channels = 2
sample_width = 2

with open(input_file, "rb") as pcm_file:
    pcm_data = pcm_file.read()

with wave.open(output_file, "wb") as wav_file:
    wav_file.setnchannels(num_channels)
    wav_file.setsampwidth(sample_width)
    wav_file.setframerate(sample_rate)
    wav_file.writeframes(pcm_data)

print(f"✅ Arquivo convertido: {output_file}")
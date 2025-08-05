import os
import json
import uuid
from dotenv import load_dotenv
from qdrant_client import QdrantClient, models
from openai import OpenAI
import tiktoken

load_dotenv(os.path.join(os.path.dirname(__file__), '..', '.env'))

QDRANT_HOST = "localhost"
QDRANT_PORT = 6333
COLLECTION_NAME = "transmeet_meetings" 

OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")
EMBEDDING_MODEL = "text-embedding-3-small"
EMBEDDING_DIMENSION = 1536

MAX_TOKENS_PER_CHUNK = 400
tokenizer = tiktoken.get_encoding("cl100k_base")

try:
    qdrant_client = QdrantClient(host=QDRANT_HOST, port=QDRANT_PORT)
    openai_client = OpenAI(api_key=OPENAI_API_KEY)
except Exception as e:
    print(f"ERROR: Failed to initialize clients: {e}")
    exit()

def get_transcription_files():
    json_dir = os.path.join(os.path.dirname(__file__), '..', 'files', 'json')
    if not os.path.exists(json_dir):
        print(f"ERROR: Directory not found: {json_dir}")
        return []
    
    return [os.path.join(json_dir, f) for f in os.listdir(json_dir) if f.startswith("transcription_") and f.endswith(".json")]

def chunk_text(text, file_name):
    chunks = []
    paragraphs = text.split('\n\n')
    for paragraph in paragraphs:
        if not paragraph.strip():
            continue
        
        tokens = tokenizer.encode(paragraph)
        if len(tokens) > MAX_TOKENS_PER_CHUNK:
            for i in range(0, len(tokens), MAX_TOKENS_PER_CHUNK):
                token_chunk = tokens[i:i + MAX_TOKENS_PER_CHUNK]
                chunks.append({
                    "text": tokenizer.decode(token_chunk),
                    "file_name": file_name
                })
        else:
            chunks.append({
                "text": paragraph,
                "file_name": file_name
            })
    return chunks

def get_embeddings(texts):
    response = openai_client.embeddings.create(
        input=texts,
        model=EMBEDDING_MODEL
    )
    return [item.embedding for item in response.data]

def index_meetings_to_qdrant():
    try:
        collections = qdrant_client.get_collections().collections
        collection_names = [collection.name for collection in collections]
        if COLLECTION_NAME not in collection_names:
            print(f"INFO: Collection '{COLLECTION_NAME}' not found. Creating it...")
            qdrant_client.create_collection(
                collection_name=COLLECTION_NAME,
                vectors_config=models.VectorParams(size=EMBEDDING_DIMENSION, distance=models.Distance.COSINE),
            )
            print(f"OK: Collection '{COLLECTION_NAME}' created successfully.")
        else:
            print(f"INFO: Collection '{COLLECTION_NAME}' already exists. Will add new data.")
    except Exception as e:
        print(f"ERROR: Qdrant error: {e}")
        return

    transcription_files = get_transcription_files()
    if not transcription_files:
        print("INFO: No transcription files found to index.")
        return
        
    print(f"Found {len(transcription_files)} transcription files to process.")

    all_chunks = []
    for file_path in transcription_files:
        try:
            with open(file_path, "r", encoding="utf-8") as f:
                data = json.load(f)
            
            full_text = " ".join(segment["text"] for segment in data.get("segments", []))
            if not full_text.strip():
                continue

            print(f"Chunking {os.path.basename(file_path)}...")
            all_chunks.extend(chunk_text(full_text, os.path.basename(file_path)))
        except Exception as e:
            print(f"WARNING: Could not process file {file_path}: {e}")

    if not all_chunks:
        print("INFO: No text content found in transcription files to index.")
        return

    print(f"\nGenerated {len(all_chunks)} chunks from meetings to be indexed.")

    print("Generating embeddings and indexing in Qdrant...")
    
    batch_size = 100
    for i in range(0, len(all_chunks), batch_size):
        batch_chunks = all_chunks[i:i + batch_size]
        texts_to_embed = [chunk['text'] for chunk in batch_chunks]
        
        print(f"Processing batch {i//batch_size + 1}...")
        embeddings = get_embeddings(texts_to_embed)
        
        qdrant_client.upsert(
            collection_name=COLLECTION_NAME,
            points=[
                models.PointStruct(
                    id=str(uuid.uuid4()),
                    vector=embedding,
                    payload={
                        "source": "meeting",
                        "text": chunk['text'], 
                        "file_name": chunk['file_name']
                    }
                )
                for chunk, embedding in zip(batch_chunks, embeddings)
            ],
            wait=True
        )
    
    print("\n" + "-" * 30)
    print("OK: Meeting indexing complete!")

if __name__ == "__main__":
    if not all([QDRANT_HOST, COLLECTION_NAME, OPENAI_API_KEY]):
        print("ERROR: Critical environment variables are missing. Check your .env file.")
    else:
        index_meetings_to_qdrant()
import os
import sys
import json
import uuid
from dotenv import load_dotenv
from github import Github, GithubException
from qdrant_client import QdrantClient, models
from openai import OpenAI
import tiktoken

load_dotenv(os.path.join(os.path.dirname(__file__), '..', '.env'))

QDRANT_HOST = "localhost"
QDRANT_PORT = 6333

OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")
EMBEDDING_MODEL = "text-embedding-granite-embedding-278m-multilingual"
EMBEDDING_DIMENSION = 768

GITHUB_TOKEN = os.getenv("GITHUB_TOKEN")
ALLOWED_EXTENSIONS = ['.py', '.js', '.json', '.md', '.txt', '.html', '.css', '.gitignore', '.ts', '.tsx']
IGNORED_DIRECTORIES = ['node_modules', '.git', '.vscode', 'dist', 'build']

MAX_TOKENS_PER_CHUNK = 500
tokenizer = tiktoken.get_encoding("cl100k_base")

try:
    qdrant_client = QdrantClient(host=QDRANT_HOST, port=QDRANT_PORT)
    openai_client = OpenAI(base_url="http://localhost:1234/v1", api_key=OPENAI_API_KEY)
    github_client = Github(GITHUB_TOKEN)
except Exception as e:
    print(f"ERROR: Failed to initialize clients: {e}")
    sys.exit(1)

def get_repo_config(repo_name):
    config_path = os.path.join(os.path.dirname(__file__), '..', 'repos.json')
    try:
        with open(config_path, 'r') as f:
            config = json.load(f)
        
        for repo_config in config.get('repositories', []):
            if repo_config.get('name') == repo_name:
                return repo_config
        return None
    except FileNotFoundError:
        print(f"ERROR: Configuration file not found at {config_path}")
        return None
    except json.JSONDecodeError:
        print(f"ERROR: Could not decode {config_path}. Please check for syntax errors.")
        return None

def get_repo_contents(repo, path=""):
    contents = {}
    try:
        dir_contents = repo.get_contents(path)
        for content in dir_contents:
            if content.type == "dir" and content.name not in IGNORED_DIRECTORIES:
                print(f"Scanning directory: {content.path}")
                contents.update(get_repo_contents(repo, content.path))
            elif content.type == "file":
                file_extension = os.path.splitext(content.name)[1]
                if file_extension in ALLOWED_EXTENSIONS:
                    print(f"Fetching file: {content.path}")
                    try:
                        contents[content.path] = content.decoded_content.decode('utf-8')
                    except Exception as e:
                        print(f"Could not decode file {content.path}: {e}")
    except GithubException as e:
        print(f"Could not access path '{path}'. Error: {e}")
    return contents

def chunk_text(text, file_path):
    chunks = []
    tokens = tokenizer.encode(text)
    for i in range(0, len(tokens), MAX_TOKENS_PER_CHUNK):
        token_chunk = tokens[i:i + MAX_TOKENS_PER_CHUNK]
        chunks.append({
            "text": tokenizer.decode(token_chunk),
            "file_path": file_path
        })
    return chunks

def get_embeddings(texts):
    response = openai_client.embeddings.create(input=texts, model=EMBEDDING_MODEL)
    return [item.embedding for item in response.data]

def index_repo_to_qdrant(repo_config):
    repo_name_gh = repo_config['github_repo']
    collection_name = repo_config['qdrant_collection']

    try:
        repo = github_client.get_repo(repo_name_gh)
        print(f"OK: Successfully connected to repository: {repo.full_name}")
    except GithubException as e:
        print(f"ERROR: GitHub Error for repo '{repo_name_gh}': {e}")
        return

    try:
        print(f"INFO: Ensuring Qdrant collection '{collection_name}' exists...")
        qdrant_client.recreate_collection(
            collection_name=collection_name,
            vectors_config=models.VectorParams(size=EMBEDDING_DIMENSION, distance=models.Distance.COSINE),
        )
        print(f"OK: Collection '{collection_name}' is ready.")
    except Exception as e:
        print(f"ERROR: Qdrant Error creating collection: {e}")
        return

    print("\n" + "-" * 30)
    print("Fetching repository code...")
    code_files = get_repo_contents(repo)
    
    all_chunks = []
    for file_path, content in code_files.items():
        if not content.strip(): continue
        print(f"Chunking {file_path}...")
        all_chunks.extend(chunk_text(content, file_path))

    print(f"\nGenerated {len(all_chunks)} chunks to be indexed.")

    if not all_chunks:
        print("INFO: No content to index.")
        return
        
    print("Generating embeddings and indexing in Qdrant...")
    batch_size = 100
    for i in range(0, len(all_chunks), batch_size):
        batch_chunks = all_chunks[i:i + batch_size]
        texts_to_embed = [chunk['text'] for chunk in batch_chunks]
        
        print(f"Processing batch {i//batch_size + 1} of {len(all_chunks)//batch_size + 1}...")
        embeddings = get_embeddings(texts_to_embed)
        
        qdrant_client.upsert(
            collection_name=collection_name,
            points=[
                models.PointStruct(
                    id=str(uuid.uuid4()),
                    vector=embedding,
                    payload={"source": "github", "code": chunk['text'], "file_path": chunk['file_path']}
                )
                for chunk, embedding in zip(batch_chunks, embeddings)
            ],
            wait=True
        )
    
    print("\n" + "-" * 30)
    print(f"OK: Indexing for repository '{repo_name_gh}' complete!")

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("ERROR: Repository name not provided.")
        print("Usage: python scripts/sync_github.py <repository_name_from_repos.json>")
        sys.exit(1)
    
    repo_name_arg = sys.argv[1]
    repo_config = get_repo_config(repo_name_arg)
    
    if not repo_config:
        print(f"ERROR: No configuration found for repository '{repo_name_arg}' in repos.json.")
        sys.exit(1)
        
    if not all([OPENAI_API_KEY, GITHUB_TOKEN]):
        print("ERROR: Critical environment variables OPENAI_API_KEY or GITHUB_TOKEN are missing.")
    else:
        index_repo_to_qdrant(repo_config)


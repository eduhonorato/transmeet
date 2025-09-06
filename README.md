[English](README.md) | [Português](README.pt-BR.md)

# Transmeet: Augmented Knowledge Assistant for Discord Meetings

Transmeet is a multifunctional Discord bot designed to transform voice channels into productive and well-documented meeting environments. It acts as a silent participant that records, transcribes, and summarizes discussions, becoming an indispensable tool for both professional teams and personal communities.

## ⚠️ Important Notice

This project uses a **self-bot library**, since the official Discord API does not allow bots to capture voice content. That means it operates under a **regular user account**, not an official Discord bot application.

**The use of self-bots violates Discord’s Terms of Service and may result in account suspension or termination.**

Transmeet was created strictly for **personal, small-scale use** — for example, recording and transcribing meetings where all participants are fully aware that the conversation is being captured. It is not intended for spam, malicious activities, or any usage that violates Discord’s policies.

The goal of this project is to provide professional benefits in controlled scenarios, such as generating meeting minutes, improving team organization, and assisting with project documentation.

## Overview

In a world where remote interactions are increasingly common, the need to document and access knowledge generated during meetings is crucial. Transmeet solves this problem by automating the entire process of capturing information in Discord voice meetings — from initial recording to minutes generation, with the ability to perform future queries.

## Key Features

- **Voice Channel Integration:** Transmeet can be invited to any voice channel in your Discord server to start monitoring and recording conversations. Additionally, it can act as an active meeting participant, using a realtime API to reply with its own voice.  
- **Automatic Transcription:** Using speech recognition technologies, the bot converts meeting audio into accurate text, attributing speech to its author.  
- **Meeting Minutes Generation:** After transcription, Transmeet processes the content and generates a structured meeting summary, highlighting key points, decisions, and action items.  
- **GitHub Repository Integration:**  
  - Transmeet can clone, process, and index entire code repositories into a vector database (Qdrant).  
  - This enables queries like: *"Where is the authentication logic in project X?"* or *"What does the class UserServiceImpl do?"*.  
- **Text Chatbot:** Chat assistant available in any text channel, answering general questions.  
- **Automatic Meeting Indexing:** Processes saved meeting transcriptions into the vector database, making them searchable.  
- **Storage & Organization:** All meeting artifacts (audio, transcription, minutes) are stored and logically organized in the filesystem for easy future access.  

## Use Cases

Transmeet is designed to be versatile, addressing a wide range of needs.

### For Developers & Professional Teams

- **Daily Standups:** Quickly record and transcribe daily syncs so absent team members can catch up.  
- **Sprint Planning & Retrospectives:** Keep a detailed record of all discussions, decisions, and action items to ensure nothing is lost.  
- **Group Code Reviews:** Document technical discussions and the reasoning behind architectural or implementation decisions.  
- **Client Meetings:** Maintain an accurate record of conversations with stakeholders for future reference.  
- **Natural Language Queries:** You can "chat" with Transmeet and ask questions about past meetings:  
  - *"What was decided about bug X in last week’s meeting?"*  
  - *"What were the main points raised by the design team?"*  
- **GitHub Repository Context:** By granting access to repositories, Transmeet can act as a "software architect" or "project manager" assistant, understanding the codebase and answering structural questions.  
- Help onboard new developers by explaining parts of the system.  
- Actively participate in technical discussions with prior knowledge of the codebase.  

### For Personal Use & Communities

- **Group Study Sessions:** Students can record discussions and use transcripts as study notes.  
- **Gaming Guild & Clan Meetings:** Capture strategy discussions, event planning, and community rules.  
- **Hobby Projects:** Keep track of ideas and decisions in collaborative projects.  
- **Podcasts & Interviews:** Use Transmeet as a simple tool to record and transcribe interviews conducted on Discord.  

## Command Reference

| Command             | Description                                                                                       |
| ------------------- | ------------------------------------------------------------------------------------------------- |
| `!join`             | Makes the bot join your current voice channel and start only transcription mode.                  |
| `!voicebot`         | Makes the bot join your current voice channel and start real-time conversation.                   |
| `!stop`             | Disconnects the bot from the voice channel and ends the session.                                  |
| `;ask <question>`   | Asks a question to the RAG system. The answer is based on indexed repositories and past meetings. |
| `!startchat`        | Enables text chatbot mode in the current channel.                                                 |
| `!stopchat`         | Disables the text chatbot.                                                                        |
| `;gerar_ata`        | Legacy command that generates a meeting minute from the last `.m4a` audio file found.             |
| `;enviar_ata`       | Sends the last generated meeting minute to the configured channel.                                |

## Project Architecture

Transmeet operates with a **hybrid and modular architecture**, combining Node.js and Python.

### Node.js Layer
- Handles Discord API interactions, event flow, and command parsing.  
- Acts as the orchestrator, coordinating Discord events with processing pipelines.  

### Python Layer
- Responsible for heavy processing tasks such as audio decoding, transcription, and meeting summarization.  
- Integrates AI-powered modules for natural language understanding and structured document generation.  

### Data Pipeline
- Audio streams captured from Discord voice channels are normalized and stored in multiple formats (WAV, M4A, etc.).  
- Transcriptions are persisted in structured JSON for further processing and queries.  
- Meeting summaries (minutes) are generated from these transcriptions, providing a reproducible audit trail.  

### Core
- **Knowledge Base (Qdrant):** A vector database storing "chunks" of information (code and transcriptions), enabling semantic similarity search with multiple strategies for better information retrieval.  
- **Intelligence (OpenAI / Local):** Configured to use both OpenAI models (gpt-4o-mini, gpt-5, etc.) and local models (via `localhost:1234`, compatible with LM Studio, Ollama, etc.) for tasks such as routing, embeddings, and response generation.  

### Configuration & Contextualization
Uses `repos.json` to define GitHub repositories that serve as contextual knowledge, enabling richer responses and project-focused documentation.

## Transcription Workflow
<img width="949" height="573" alt="image" src="https://github.com/user-attachments/assets/13d29cbf-79f0-44bc-89e6-3c71ba674a71" />

### Example
<img width="665" height="597" alt="image" src="https://github.com/user-attachments/assets/94a2ad12-b7a3-42f3-8626-f463955adcee" />

## Router system and information retrieval based on the chosen collection
<img width="778" height="207" alt="image" src="https://github.com/user-attachments/assets/2551d27c-2a80-4350-975a-e3fa48646008" />
<img width="657" height="249" alt="image" src="https://github.com/user-attachments/assets/82e19ce4-e4ef-4937-aa62-d9ffdc81c4dd" />

This architecture provides clear separation of concerns: real-time communication remains lightweight in Node.js, while CPU-intensive tasks (audio + AI) are offloaded to Python. This design makes the system extensible, modular, and adaptable to new AI workflows or integrations in the future.  

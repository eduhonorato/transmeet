[Português](README.pt-BR.md) | [English](README.md)

# Transmeet: Assistente de Conhecimento Aumentado para Reuniões no Discord

Transmeet é um bot multifuncional para Discord projetado para transformar canais de voz em ambientes de reunião produtivos e documentados. Ele atua como um participante silencioso que grava, transcreve e resume discussões, tornando-se uma ferramenta indispensável tanto para equipes profissionais quanto para comunidades pessoais.

## ⚠️ Aviso Importante

Este projeto utiliza uma biblioteca de **self-bots**, já que a API oficial do Discord não permite que bots capturem conteúdo de voz. Isso significa que ele opera sob uma **conta de usuário comum**, não em um aplicativo oficial de bots do Discord.

**O uso de self-bots viola os Termos de Serviço do Discord e pode resultar na suspensão ou encerramento da sua conta.**

O Transmeet foi criado estritamente para uso pessoal e em pequena escala — por exemplo, gravar e transcrever reuniões onde todos os participantes estão cientes de que a conversa está sendo capturada. Não se destina a spam, atividades maliciosas ou qualquer uso que infrinja as políticas do Discord.

O objetivo deste projeto é fornecer um benefício profissional em cenários controlados, como gerar atas de reuniões, melhorar a organização da equipe e auxiliar na documentação do projeto.

## Visão Geral

Em um mundo onde as interações remotas são cada vez mais comuns, a necessidade de documentar e acessar o conhecimento gerado em reuniões é crucial. O Transmeet resolve esse problema automatizando todo o processo de captura de informações em reuniões de voz no Discord, desde a gravação inicial até a geração de atas e a possibilidade de consultas futuras.

## Funcionalidades Principais

- **Integração com Canais de Voz:** O Transmeet pode ser convidado para qualquer canal de voz no seu servidor Discord para começar a monitorar e gravar a conversa. Além disso, é possível que ele atue como um participante ativo da reunião, utilizando uma API de realtime, respondendo com a própria voz a interação dos usuários.
- **Transcrição Automática:** Utilizando tecnologias de reconhecimento de fala, o bot converte o áudio da reunião em texto de forma precisa, atribuindo a fala ao autor.
- **Geração de Atas (Minutas):** Após a transcrição, o Transmeet processa o conteúdo e gera uma ata da reunião estruturada, destacando pontos-chave, decisões e ações a serem tomadas.
- **Integração com Repositórios GitHub:**
  - O Transmeet pode clonar, processar e indexar repositórios de código inteiros em uma base de dados vetorial (Qdrant).
  - Isso permite que ele responda a perguntas como: *"Onde está a lógica de autenticação no projeto X?"* ou *"Qual a função da classe UserServiceImpl?"*.
- **Chatbot de Texto:** Assistente de chat em qualquer canal de texto, respondendo a perguntas gerais.
- **Indexação Automática de Reuniões:** Processamento das transcrições de reuniões salvas para indexação na base de dados vetorial, tornando-as pesquisáveis.
- **Armazenamento e Organização:** Todos os artefatos da reunião (áudio, transcrição, ata) são salvos e organizados de forma lógica no sistema de arquivos, permitindo fácil acesso posterior.

## Casos de Uso

O Transmeet foi projetado para ser versátil, atendendo a uma ampla gama de necessidades.

### Para Desenvolvedores e Equipes Profissionais

- **Reuniões de Sincronia (Dailies):** Grave e transcreva rapidamente as reuniões diárias para que membros da equipe que não puderam comparecer possam se atualizar.
- **Planejamento de Sprints e Retrospectivas:** Tenha um registro detalhado de todas as discussões, decisões e itens de ação, garantindo que nada seja perdido.
- **Revisão de Código em Grupo:** Documente discussões técnicas e o raciocínio por trás das decisões de arquitetura ou implementação.
- **Reuniões com Clientes:** Mantenha um registro fiel das conversas com stakeholders para referência futura.
- **Consultas em Linguagem Natural:** Você poderá "conversar" com o Transmeet e fazer perguntas sobre reuniões passadas.
  - *"O que foi decidido sobre o bug X na reunião da semana passada?"*
  - *"Quais foram os principais pontos levantados pelo time de design?"*
- **Contexto de Repositórios GitHub:** Ao fornecer acesso a repositórios do GitHub, o Transmeet poderá atuar como um "arquiteto de software" ou "gerente de projeto" assistente. Ele entenderá o código-fonte e poderá responder a perguntas sobre a estrutura do código.
- Ajudar no onboarding de novos desenvolvedores, explicando partes do sistema.
- Participar de discussões técnicas com conhecimento prévio do código-base.

### Para Uso Pessoal e Comunidades

- **Sessões de Estudo em Grupo:** Alunos podem gravar discussões e usar as transcrições como notas de estudo.
- **Reuniões de Guildas e Clãs de Jogos:** Capture discussões sobre estratégias, planejamento de eventos e regras da comunidade.
- **Projetos de Hobby:** Mantenha o controle de ideias e decisões em projetos colaborativos.
- **Podcasts e Entrevistas:** Use o Transmeet como uma ferramenta simples para gravar e transcrever entrevistas realizadas no Discord.

## Referência de Comandos

| Comando             | Descrição                                                                                             |
| ------------------- | ----------------------------------------------------------------------------------------------------- |
| `!join`             | Faz o bot entrar no canal de voz em que você está e iniciar o modo de conversação em tempo real.        |
| `!stop`             | Desconecta o bot do canal de voz e encerra a sessão.                                                  |
| `;ask <pergunta>`   | Faz uma pergunta para o sistema RAG. A resposta será baseada nos repositórios e reuniões indexados. |
| `!startchat`        | Ativa o modo de chatbot de texto no canal atual.                                                      |
| `!stopchat`         | Desativa o chatbot de texto.                                                                          |
| `;gerar_ata`        | Comando legado que gera uma ata a partir do último arquivo de áudio `.m4a` encontrado.                 |
| `;enviar_ata`       | Envia a última ata gerada para o canal configurado.                                                   |

## Arquitetura do Projeto

O Transmeet opera com uma arquitetura híbrida e modular, utilizando Node.js e Pyhton.

### Camada Node.js
- Lida com as interações da API do Discord, fluxo de eventos e análise de comandos.
- Atua como orquestrador, coordenando os eventos do Discord e os pipelines de processamento.

### Camada Python
- Responsável por tarefas pesadas de processamento, como decodificação de áudio, transcrição e resumo de reuniões.
- Integra módulos com tecnologia de IA para compreensão de linguagem natural e geração de documentos estruturados.

### Pipeline de Dados
- Os fluxos de áudio capturados dos canais de voz do Discord são normalizados e armazenados em vários formatos (WAV, M4A, etc.).
- As transcrições são persistidas em JSON estruturado, permitindo processamento e consultas posteriores.
- Resumos de reuniões (ATAs) são gerados a partir dessas transcrições, fornecendo uma trilha de auditoria reproduzível.

### Núcleo
- **Base de Conhecimento (Qdrant):** Um banco de dados vetorial que armazena os "pedaços" de informação (código e transcrições) e permite buscas por similaridade semântica, com variadas abordagens que melhoram o retrieval de informações.
- **Inteligência (OpenAI / Local):** O projeto está configurado para usar tanto modelos da OpenAI (gpt-4o-mini, gpt-5, etc.) quanto modelos locais (via `localhost:1234`, compatível com LM Studio, Ollama, etc.) para tarefas como roteamento, geração de embeddings e criação de respostas.

### Configuração e Contextualização
Utiliza repos.json para definir repositórios do GitHub que servem como conhecimento contextual, permitindo respostas mais ricas e documentação com foco no projeto.

Essa arquitetura separa as preocupações de forma clara: a comunicação em tempo real é mantida leve em Node.js, enquanto tarefas que exigem uso intensivo de CPU (áudio + IA) são transferidas para Python. Esse design torna o sistema extensível, modular e adaptável a novos fluxos de trabalho ou outras integrações de IA.

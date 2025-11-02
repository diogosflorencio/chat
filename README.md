# Chat WebSocket

Aplicação de chat em tempo real desenvolvida com WebSocket.

## Estrutura

- `public/` - Arquivos frontend
- `public/index.html` - Interface principal
- `public/submundo/index.html` - Interface alternativa
- `public/script/script.js` - Lógica do cliente
- Firebase Hosting configurado

## Funcionalidades

- Chat em tempo real via WebSocket
- Upload e exibição de imagens
- Lista de usuários online
- Comandos administrativos (/reset, /reload)

## Comandos

- `/imagem + link` - Enviar imagens
- `/reset` - Excluir todas as mensagens (admin)
- `/reload` - Reiniciar servidor (admin)
- `/excluir` - Apagar suas mensagens (não funcional)

## Desenvolvimento

Interface e funcionalidades em constante melhorias. Tema WhatsApp como referência de UI.

Servidor disponível em: https://github.com/diogosflorencio/chat-server


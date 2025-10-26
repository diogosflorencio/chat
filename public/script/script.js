// cria variaveis de elementos do dom
let usuario = document.getElementById("usuario");
let inputUsuario = document.getElementById("input-usuario");
let botao = document.getElementById("botao-enviar");
let input = document.getElementById("input-mensagem");
let mensagem = document.getElementById("mensagem");
const modalImagem = document.getElementById("modal-imagem");
const imagemModal = document.getElementById("imagem-modal");
let usuarioOnline = document.getElementById("usuario-online");
let chats = document.getElementById("chats");

chats.addEventListener("click", (event)=>{
  chats.childNodes.forEach(chat => {
    if(chat.nodeType === 1){
      chat.classList.remove("chat-selecionado");

    }
    event.target.classList.add("chat-selecionado")
  })  

})
// pega o nome do usuario, se não tiver no localstarage
if (localStorage.getItem("nomeDeUsuario")) {
  nome = localStorage.getItem("nomeDeUsuario");
} else {
  const nomesUsuarios = [""];

  let numeroUsuario = Math.round(Math.random() * 18);
  nome = window.prompt("Digite seu nome: ", `${nomesUsuarios[numeroUsuario]}`);
  nome == null
    ? (nome = "Sem nome")
    : localStorage.setItem("nomeDeUsuario", nome);
}

inputUsuario.value = `${nome}`;

inputUsuario.addEventListener("change", () => {
  nome = inputUsuario.value;
  localStorage.setItem("nomeDeUsuario", nome);
  usuario.innerHTML = `<p><span style="font-family: monospace; font-size: 16px; color: red;">servidor:</span> <b>${nome}</b>, você está <span style="color:green">conectado!</span>!</p>`;
});

// conecta ao backend
const ws = new WebSocket("ws://localhost:8080") // testes
// let ws;
// if (document.location.pathname === "/submundo/") {
//   ws = new WebSocket("wss://mixed-babara-submundo-a8aa163c.koyeb.app/");
//   // const ws = new WebSocket("ws://localhost:8080") // testes
// } else {
//   ws = new WebSocket("wss://clear-maggy-chat-diogo-11b743c1.koyeb.app/");
//   // const ws = new WebSocket("ws://localhost:8080") // testes
// }

// func pra enviar as coisas
function enviar(msg) {
  ws.send(`${nome}: ${msg}`);
}
// verifica conexão com servidor e se usuario entrou e saiu
ws.onopen = () => {
  usuario.innerHTML = `<p><span style="font-family: monospace; font-size: 16px; color: red; ">servidor:</span> <b>${nome}</b>, você está <span style="color:green">conectado!</span>!</p>`;

  // ws.send("servidor: "+ nome + " está conectado!")
  ws.send(`${nome} entrou na sala!`);
  

  // manda pings pro servidor pra manter a conexão por mais de 60 segundos
  setInterval(function () {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send("ping");
    }
  }, 50000);
};
ws.onclose = () => {
  usuario.innerHTML = `<p><span style="font-family: monospace; font-size: 16px; color: red; ">servidor:</span> <b>${nome}</b>, você está <span style="color:red">desconectado! (reinicie a página)</span></p>`;
};

function ampliarImagem(img) {
  imagemModal.src = img.src;
  modalImagem.style.display = "flex";
}

mensagem.addEventListener("click", (event) => {
  if (event.target && event.target.classList.contains("imagem-enviada")) {
    ampliarImagem(event.target);
  }
});

modalImagem.addEventListener("click", () => {
  modalImagem.style.display = "none";
  imagemModal.src = "";
});

let agora = new Date();
let hora = agora.getHours().toString().padStart(2, "0");
let minutos = agora.getMinutes().toString().padStart(2, "0");

let tempoHTML = `<span style="font-size: 9px; color: #075e54; vertical-align: baseline; align-self:end; margin-left: 4px;">${hora}:${minutos}</span>`;

input.addEventListener("keydown", (evento) => {
  if (evento.key === "Enter") {
    const texto = input.value.trim();
    if (texto !== "") {
      if (texto.toLowerCase().includes("/imagem")) {
        const url = texto.replace("/imagem", "").trim();
        enviar(
          `<img class="imagem-enviada" src="${url}" alt="imagem enviada" style="width:200px">`
        );
      } else if (texto.includes("/limpar")) {
        enviar(`${texto}`);
      } else {
        enviar(`${texto} ${tempoHTML}`);
      }
    } else {
      console.log("msg vazia");
    }
    input.value = "";
  }
});

botao.addEventListener("click", () => {
  const texto = input.value.trim();
  if (texto !== "") {
    if (texto.toLowerCase().includes("/imagem")) {
      const url = texto.replace("imagem", "").trim();
      enviar(
        `<img class="imagem-enviada" src="${url}" alt="imagem enviada" style="width:200px">`
      );
    } else if (texto.includes("/limpar")) {
      enviar(`${texto}`);
    } else {
      enviar(`${texto} ${tempoHTML}`);
    }
  } else {
    console.log("msg vazia");
  }
  input.value = "";
});

ws.onmessage = (event) => {
  const data = event.data; // texto recebido do servidor
  let mensagens = [];

  // Tenta transformar o texto em objeto json
  try {
    const obj = JSON.parse(data);

    // Se o objeto tem um array de mensagens, usa ele (pq existe as mensagens e o historico de mensagens)
    if (Array.isArray(obj.mensagens)) {
      mensagens = obj.mensagens;
    }
  } catch {
    // se não for JSON, usa o texto original
    mensagens = [data];
  }

  // Adiciona cada mensagem na tela
  mensagens.forEach((msg) => {
    if (msg.startsWith(nome + ": ") && !msg.includes("/limpar")) {
      mensagemFiltrada = msg.slice(nome.length + 2); // fiz um fateamento pra parar de exibir o nome de usuario de quem ta enviando pq é desnecessario
      mensagem.innerHTML += `<div id="msg-usuario"> ${mensagemFiltrada}</div>`;
    } else if (msg.endsWith("sala!")) {
      mensagem.innerHTML += `<div id="mensagem-log"> ${msg}</div>`;
      usuarioOnline.innerHTML += `<li>${msg.split(" ").slice(0,1)}</li>`; // o ideial é que o servidor me diga quem está online, assim isso sempre reflitirá em todos os usuarios. tbm deve dizer quem não está mais conectado. ou quem nao está enviando ping/recendo pong, caso houvesse implementação
    } else if (msg.includes("/limpar")) {
      mensagem.innerHTML += `<div id="mensagem-log">o admin limpou o chat</div>`;
    } else {
      mensagem.innerHTML += `<div id="msg-outros"> ${msg}</div>`; //adição de tag pra css organizar tudo | identando as mensagens corretamente
    }
  });

  // dá scroll para a última mensagem aparecer
  mensagem.scrollTop = mensagem.scrollHeight;
};

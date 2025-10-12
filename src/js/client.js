// Connect to the main server (replace localhost with your MAIN server's LAN or public IP)
const mainSocket = io("http://127.0.0.1:4000");

const serversList = document.getElementById("serversList");
const createServerBtn = document.getElementById("cbtn");

let dynamicSocket = null;

// When "Start My Server" button is clicked
createServerBtn.addEventListener("click", async () => {
    console.log("button clicked");
    try {
        console.log("button licker")
        const res = await fetch("http://127.0.0.1:4000/start");
        const data = await res.json();
        alert(data.message);
    } catch (err) {
        console.error("Error starting server:", err);
    }
});

// Real-time update of available servers
mainSocket.on("updateServers", (servers) => {
    serversList.innerHTML = "";

    if (servers.length === 0) {
        const li = document.createElement("li");
        li.textContent = "No servers online yet.";
        serversList.appendChild(li);
        return;
    }

    servers.forEach(({ host, port }) => {
        const li = document.createElement("li");
        li.textContent = `Server @ ${host}:${port}`;
        li.onclick = () => connectToServer(host, port);
        serversList.appendChild(li);
    });
});

function connectToServer(host, port) {
    if (dynamicSocket) dynamicSocket.disconnect();

    dynamicSocket = io(`http://${host}:${port}`);

    document.getElementById("chatSection").style.display = "block";

    const messages = document.getElementById("messages");
    const msgInput = document.getElementById("msgInput");
    const sendBtn = document.getElementById("sendBtn");

    // Clear previous messages
    messages.innerHTML = "";

    dynamicSocket.on("connect", () => {
        console.log("Connected to dynamic server:", dynamicSocket.id);
    });

    dynamicSocket.on("message", (msg) => {
        const li = document.createElement("li");
        li.textContent = msg;
        messages.appendChild(li);
    });

    sendBtn.onclick = () => {
        const msg = msgInput.value.trim();
        if (!msg) return;
        dynamicSocket.emit("message", msg);
        const li = document.createElement("li");
        li.textContent = `You: ${msg}`;
        messages.appendChild(li);
        msgInput.value = "";
    };
}

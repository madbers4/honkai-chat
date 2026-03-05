// Глобальные переменные (сохраняются в рамках одного экземпляра)
let connections = new Set();
let apiDomain = null;

exports.handler = async (event) => {
    // Определяем WebSocket по наличию connectionId
    const isWebSocket = event.requestContext && event.requestContext.connectionId;

    console.log('INCOMING:', JSON.stringify({
        type: isWebSocket ? 'WS' : 'HTTP',
        connectionId: event.requestContext?.connectionId,
        routeKey: event.requestContext?.routeKey,
        body: event.body?.substring(0, 200)
    }));

    if (isWebSocket) {
        const ctx = event.requestContext;
        const connectionId = ctx.connectionId;
        const routeKey = ctx.routeKey || '$default';
        const domain = ctx.apiGateway?.domain;

        if (domain && !apiDomain) apiDomain = domain;

        console.log(`WS | ${routeKey} | ${connectionId}`);

        // --- Подключение ---
        if (routeKey === '$connect') {
            connections.add(connectionId);
            console.log(`Connected. Total: ${connections.size}`);
            return { statusCode: 200 };
        }

        // --- Отключение ---
        if (routeKey === '$disconnect') {
            connections.delete(connectionId);
            console.log(`Disconnected. Left: ${connections.size}`);
            return { statusCode: 200 };
        }

        // --- Сообщение ---
        // Парсим тело
        let message = {};
        if (event.body) {
            try {
                message = JSON.parse(event.body);
            } catch {
                message = { text: event.body };
            }
        }

        const token = process.env.YC_TOKEN;
        const time = new Date().toISOString();

        // 1. Отправляем эхо отправителю
        if (apiDomain && connectionId) {
            const echoUrl = `https://${apiDomain}/@connections/${connectionId}`;
            await fetch(echoUrl, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ echo: message, time, from: connectionId })
            }).catch(err => console.error('Echo error:', err.message));
        }

        // 2. Рассылаем всем остальным (broadcast)
        if (apiDomain) {
            const broadcastMsg = { broadcast: message, time, sender: connectionId };
            const promises = [];
            for (const connId of connections) {
                if (connId === connectionId) continue;
                const url = `https://${apiDomain}/@connections/${connId}`;
                promises.push(
                    fetch(url, {
                        method: 'POST',
                        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
                        body: JSON.stringify(broadcastMsg)
                    }).then(async resp => {
                        if (!resp.ok && resp.status === 410) {
                            connections.delete(connId);
                            console.log(`Removed stale connection ${connId}`);
                        }
                    }).catch(err => console.error(`Send to ${connId} failed:`, err.message))
                );
            }
            await Promise.allSettled(promises);
        }

        return { statusCode: 200 };
    } else {
        // HTTP: возвращаем HTML-страницу с клиентом
        const html = `<!DOCTYPE html>
<html>
<head>
    <title>WebSocket Broadcast Test</title>
    <meta charset="utf-8">
    <style>
        body { font-family: sans-serif; max-width: 600px; margin: 50px auto; padding: 20px; }
        #messages { border: 1px solid #ccc; height: 300px; overflow-y: scroll; padding: 10px; margin-bottom: 10px; }
        #status { color: gray; margin-bottom: 10px; }
        input[type=text] { width: 70%; padding: 8px; }
        button { padding: 8px 15px; }
    </style>
</head>
<body>
    <h2>WebSocket Broadcast Test</h2>
    <p>URL: <code>wss://d5d026k9uet5ke497j8d.a6hc9vya.apigw.yandexcloud.net</code></p>
    <div id="status">🔴 Отключено</div>
    <div id="messages"></div>
    <div>
        <input type="text" id="messageInput" placeholder="Введите сообщение..." disabled>
        <button id="sendBtn" disabled>Отправить</button>
        <button id="connectBtn">Подключиться</button>
        <button id="disconnectBtn" disabled>Отключиться</button>
    </div>

    <script>
        const WS_URL = 'wss://d5d026k9uet5ke497j8d.a6hc9vya.apigw.yandexcloud.net';
        let socket = null;
        const messagesDiv = document.getElementById('messages');
        const statusDiv = document.getElementById('status');
        const input = document.getElementById('messageInput');
        const sendBtn = document.getElementById('sendBtn');
        const connectBtn = document.getElementById('connectBtn');
        const disconnectBtn = document.getElementById('disconnectBtn');

        function log(message, isSent = false) {
            const msgDiv = document.createElement('div');
            msgDiv.style.color = isSent ? 'blue' : 'green';
            msgDiv.style.margin = '5px 0';
            msgDiv.textContent = (isSent ? '➡️ ' : '⬅️ ') + message;
            messagesDiv.appendChild(msgDiv);
            messagesDiv.scrollTop = messagesDiv.scrollHeight;
        }

        function setConnected(connected) {
            statusDiv.textContent = connected ? '🟢 Подключено' : '🔴 Отключено';
            input.disabled = !connected;
            sendBtn.disabled = !connected;
            connectBtn.disabled = connected;
            disconnectBtn.disabled = !connected;
        }

        connectBtn.addEventListener('click', () => {
            socket = new WebSocket(WS_URL);

            socket.onopen = () => {
                log('Соединение установлено');
                setConnected(true);
            };

            socket.onmessage = (event) => {
                // Универсальная обработка любых типов данных
                if (typeof event.data === 'string') {
                    log(event.data);
                } else if (event.data instanceof Blob) {
                    const reader = new FileReader();
                    reader.onload = () => log(reader.result);
                    reader.readAsText(event.data);
                } else if (event.data instanceof ArrayBuffer) {
                    const decoder = new TextDecoder('utf-8');
                    log(decoder.decode(event.data));
                } else {
                    log('Неподдерживаемый тип данных: ' + typeof event.data);
                }
            };

            socket.onerror = (error) => {
                log('Ошибка: ' + error);
            };

            socket.onclose = () => {
                log('Соединение закрыто');
                setConnected(false);
                socket = null;
            };
        });

        disconnectBtn.addEventListener('click', () => {
            if (socket) {
                socket.close();
            }
        });

        sendBtn.addEventListener('click', () => {
            if (socket && input.value.trim() !== '') {
                const msg = input.value;
                socket.send(JSON.stringify({ text: msg }));
                log(msg, true);
                input.value = '';
            }
        });

        input.addEventListener('keypress', (e) => {
            if (e.key === 'Enter' && !sendBtn.disabled) {
                sendBtn.click();
            }
        });
    </script>
</body>
</html>`;

        return {
            statusCode: 200,
            headers: { 'Content-Type': 'text/html; charset=utf-8' },
            body: html,
            isBase64Encoded: false
        };
    }
};
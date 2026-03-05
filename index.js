// Глобальные переменные (сохраняются между вызовами в рамках одного экземпляра функции)
let connections = new Set();        // множество активных connectionId
let apiDomain = null;               // домен API Gateway (общий для всех)

exports.handler = async (event, context) => {
    const isWebSocket = event.requestContext && event.requestContext.routeKey;

    if (isWebSocket) {
        // === WebSocket-обработка ===
        const { connectionId, routeKey, apiGateway } = event.requestContext;
        const domain = apiGateway?.domain;

        // Запоминаем домен при первом вызове
        if (domain && !apiDomain) {
            apiDomain = domain;
        }

        console.log(`WebSocket event: ${routeKey}, connection: ${connectionId}`);

        // Подключение
        if (routeKey === '$connect') {
            connections.add(connectionId);
            console.log(`Текущее количество подключений: ${connections.size}`);
            return { statusCode: 200 };
        }

        // Отключение
        if (routeKey === '$disconnect') {
            connections.delete(connectionId);
            console.log(`Отключился ${connectionId}, осталось: ${connections.size}`);
            return { statusCode: 200 };
        }

        // Получение сообщения
        if (routeKey === '$default') {
            let message = {};
            try {
                message = JSON.parse(event.body);
            } catch (e) {
                message = { text: event.body };
            }

            // Сообщение для рассылки
            const broadcastMessage = {
                broadcast: message,
                time: new Date().toISOString(),
                sender: connectionId
            };

            // Рассылаем всем подключённым клиентам
            if (apiDomain) {
                const token = process.env.YC_TOKEN;
                const promises = [];

                for (const connId of connections) {
                    // Не отправляем самому отправителю (опционально, можно и ему)
                    if (connId === connectionId) continue;

                    const url = `https://${apiDomain}/@connections/${connId}`;
                    promises.push(
                        fetch(url, {
                            method: 'POST',
                            headers: {
                                'Authorization': `Bearer ${token}`,
                                'Content-Type': 'application/json'
                            },
                            body: JSON.stringify(broadcastMessage)
                        }).catch(err => {
                            console.error(`Ошибка отправки клиенту ${connId}:`, err.message);
                            // Если соединение уже закрыто (410 GONE), удаляем его из списка
                            if (err.response?.status === 410) {
                                connections.delete(connId);
                            }
                        })
                    );
                }

                await Promise.allSettled(promises);
                console.log(`Сообщение разослано ${promises.length} клиентам`);
            }

            return { statusCode: 200 };
        }

        return { statusCode: 400 };
    } else {
        // === HTTP: отдаём HTML-страницу с фиксированным WebSocket URL ===
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
                log(event.data);
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
            headers: {
                'Content-Type': 'text/html; charset=utf-8'
            },
            body: html,
            isBase64Encoded: false
        };
    }
};
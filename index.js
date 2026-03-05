// Универсальная функция: обрабатывает HTTP и WebSocket
exports.handler = async (event, context) => {
    // Определяем тип события
    const isWebSocket = event.requestContext && event.requestContext.routeKey;

    if (isWebSocket) {
        // === WebSocket-обработка ===
        const { connectionId, routeKey, apiGateway } = event.requestContext;
        const domain = apiGateway?.domain;

        console.log(`WebSocket event: ${routeKey}, connection: ${connectionId}`);

        // Подключение
        if (routeKey === '$connect') {
            return { statusCode: 200 };
        }

        // Отключение
        if (routeKey === '$disconnect') {
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

            // Отправляем эхо-ответ обратно клиенту
            if (domain && connectionId) {
                const url = `https://${domain}/@connections/${connectionId}`;
                const token = process.env.YC_TOKEN; // IAM-токен сервисного аккаунта

                try {
                    await fetch(url, {
                        method: 'POST',
                        headers: {
                            'Authorization': `Bearer ${token}`,
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify({
                            echo: message,
                            time: new Date().toISOString(),
                            connectionId: connectionId
                        })
                    });
                } catch (error) {
                    console.error('Error sending message:', error.message);
                }
            }
            return { statusCode: 200 };
        }

        return { statusCode: 400 };
    } else {
        // === HTTP-обработка (отдаём HTML-страницу) ===
        const html = `<!DOCTYPE html>
<html>
<head>
    <title>WebSocket Echo Test</title>
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
    <h2>WebSocket Echo Test</h2>
    <div id="status">🔴 Отключено</div>
    <div id="messages"></div>
    <div>
        <input type="text" id="messageInput" placeholder="Введите сообщение..." disabled>
        <button id="sendBtn" disabled>Отправить</button>
        <button id="connectBtn">Подключиться</button>
        <button id="disconnectBtn" disabled>Отключиться</button>
    </div>

    <script>
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
            const wsUrl = prompt('Введите URL WebSocket (например wss://ваш-домен.apigw.yandexcloud.net/)');
            if (!wsUrl) return;

            socket = new WebSocket(wsUrl);

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
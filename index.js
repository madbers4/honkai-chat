// Глобальные переменные (сохраняются между вызовами в рамках одного экземпляра функции)
let connections = new Set();        // множество активных connectionId
let apiDomain = null;               // домен API Gateway (общий для всех)

exports.handler = async (event) => {
    // === УНИВЕРСАЛЬНОЕ ОПРЕДЕЛЕНИЕ ТИПА ЗАПРОСА ===
    // Если есть connectionId – это WebSocket-событие, иначе – HTTP
    const isWebSocket = event.requestContext && event.requestContext.connectionId;

    // Для отладки – логируем входящий event (уберите, если не нужно)
    console.log('INCOMING:', JSON.stringify({
        type: isWebSocket ? 'WEBSOCKET' : 'HTTP',
        connectionId: event.requestContext?.connectionId,
        routeKey: event.requestContext?.routeKey,
        body: event.body
    }, null, 2));

    if (isWebSocket) {
        // === WebSocket-обработка ===
        const { connectionId, routeKey, apiGateway } = event.requestContext;
        const domain = apiGateway?.domain;

        // Запоминаем домен при первом вызове (нужен для отправки ответов)
        if (domain && !apiDomain) {
            apiDomain = domain;
        }

        console.log(`WebSocket | routeKey: ${routeKey}, connectionId: ${connectionId}`);

        // --- Подключение ---
        if (routeKey === '$connect') {
            connections.add(connectionId);
            console.log(`Клиент подключился. Всего подключений: ${connections.size}`);
            return { statusCode: 200 };
        }

        // --- Отключение ---
        if (routeKey === '$disconnect') {
            connections.delete(connectionId);
            console.log(`Клиент отключился. Осталось: ${connections.size}`);
            return { statusCode: 200 };
        }

        // --- Сообщение ($default или любой другой routeKey) ---
        // Парсим тело сообщения (если оно есть)
        let message = {};
        if (event.body) {
            try {
                message = JSON.parse(event.body);
            } catch (e) {
                // Если не JSON – сохраняем как текст
                message = { text: event.body };
            }
        }

        // Сообщение для рассылки
        const broadcastMessage = {
            broadcast: message,
            time: new Date().toISOString(),
            sender: connectionId
        };

        // Рассылаем всем КРОМЕ отправителя
        if (apiDomain) {
            const token = process.env.YC_TOKEN; // IAM-токен сервисного аккаунта
            const promises = [];

            for (const connId of connections) {
                // Не отправляем самому себе
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
                    })
                    .then(async resp => {
                        if (!resp.ok) {
                            // Если соединение уже закрыто (код 410), удаляем его из списка
                            if (resp.status === 410) {
                                connections.delete(connId);
                                console.log(`Клиент ${connId} больше не доступен (410), удалён из списка`);
                            } else {
                                const errText = await resp.text();
                                console.error(`Ошибка отправки клиенту ${connId}: ${resp.status} – ${errText}`);
                            }
                        }
                    })
                    .catch(err => {
                        console.error(`Исключение при отправке клиенту ${connId}:`, err.message);
                    })
                );
            }

            await Promise.allSettled(promises);
            console.log(`Сообщение разослано ${promises.length} клиентам`);
        }

        return { statusCode: 200 };
    } else {
        // === HTTP: возвращаем HTML-страницу с тестовым клиентом ===
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
                // Универсальная обработка входящих данных (строки или Blob)
                if (typeof event.data === 'string') {
                    log(event.data);
                } else if (event.data instanceof Blob) {
                    const reader = new FileReader();
                    reader.onload = () => log(reader.result);
                    reader.readAsText(event.data);
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
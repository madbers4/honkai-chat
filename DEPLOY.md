# 🚀 Инструкция по настройке деплоя Honkai Chat

## Содержание

1. [Создание ВМ в Yandex Cloud](#1-создание-вм-в-yandex-cloud)
2. [Настройка ВМ](#2-настройка-вм)
3. [Настройка GitHub Secrets](#3-настройка-github-secrets)
4. [Первый деплой](#4-первый-деплой)
5. [Настройка домена и HTTPS (опционально)](#5-настройка-домена-и-https-опционально)
6. [Полезные команды](#6-полезные-команды)

---

## 1. Создание ВМ в Yandex Cloud

### Через консоль (console.cloud.yandex.ru)

1. Перейди в **Compute Cloud** → **Создать ВМ**
2. Параметры:
   - **Имя**: `honkai-chat`
   - **Зона**: `ru-central1-a` (или любая)
   - **ОС**: Ubuntu 22.04 LTS
   - **Платформа**: Intel Ice Lake, 2 vCPU, 2 GB RAM (минимум) — вполне хватит
   - **Диск**: 10 GB SSD
   - **Сеть**: создай или выбери существующую VPC, публичный IP — **обязательно**
   - **SSH-ключ**: вставь свой публичный ключ (`~/.ssh/id_ed25519.pub`)
   - **Логин**: `deploy` (или любой, запомни — это `VM_USER`)

3. Нажми **Создать** и дождись запуска. Запиши **публичный IP** — это `VM_HOST`.

---

## 2. Настройка ВМ

### Подключение

```bash
ssh deploy@<VM_HOST>
```

### Установка Node.js 20

```bash
# Добавляем NodeSource репозиторий
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -

# Устанавливаем
sudo apt-get install -y nodejs

# Проверяем
node -v   # → v20.x.x
npm -v    # → 10.x.x
```

### Установка pm2

```bash
sudo npm install -g pm2

# Настраиваем автозапуск при перезагрузке ВМ
pm2 startup
# pm2 выведет команду вида:
# sudo env PATH=$PATH:/usr/bin pm2 startup systemd -u deploy --hp /home/deploy
# ВЫПОЛНИ ЕЁ
```

### Создание директории для приложения

```bash
sudo mkdir -p /opt/honkai-chat
sudo chown deploy:deploy /opt/honkai-chat
```

### Открытие порта

Порт 3001 (или 80, если будешь использовать nginx) должен быть открыт.

В **Yandex Cloud Console**:
1. Перейди в **VPC** → **Группы безопасности**
2. Добавь правило для входящего трафика:
   - **Порт**: `3001` (или `80` и `443` для nginx)
   - **Протокол**: TCP
   - **Источник**: `0.0.0.0/0`

---

## 3. Настройка GitHub Secrets

В репозитории на GitHub:

1. Перейди в **Settings** → **Secrets and variables** → **Actions**
2. Добавь три секрета:

| Секрет | Значение | Пример |
|--------|----------|--------|
| `VM_HOST` | Публичный IP виртуальной машины | `51.250.xx.xx` |
| `VM_USER` | Имя пользователя SSH | `deploy` |
| `VM_SSH_KEY` | Приватный SSH-ключ для подключения | Содержимое файла `~/.ssh/id_ed25519` |

### Как получить `VM_SSH_KEY`

Если у тебя ещё нет отдельной пары ключей для деплоя, создай:

```bash
# На СВОЁМ компьютере (не на ВМ)
ssh-keygen -t ed25519 -C "github-deploy" -f ~/.ssh/honkai_deploy

# Публичный ключ → на ВМ
ssh-copy-id -i ~/.ssh/honkai_deploy.pub deploy@<VM_HOST>

# Приватный ключ → в GitHub Secret
cat ~/.ssh/honkai_deploy
# Скопируй ВСЁ содержимое (включая -----BEGIN/END-----) в секрет VM_SSH_KEY
```

---

## 4. Первый деплой

### Автоматический (через push)

```bash
git add .
git commit -m "Setup deploy"
git push origin main
```

Workflow запустится автоматически. Следи за прогрессом в **Actions** на GitHub.

### Ручная проверка после деплоя

```bash
# Подключись к ВМ
ssh deploy@<VM_HOST>

# Проверь pm2
pm2 status
# Должен быть процесс "honkai-chat" со статусом "online"

# Проверь логи
pm2 logs honkai-chat --lines 20

# Проверь доступность
curl http://localhost:3001
```

### Открой в браузере

```
http://<VM_HOST>:3001/guest    — гостевой чат
http://<VM_HOST>:3001/actor    — актёрская панель
```

---

## 5. Настройка домена и HTTPS (опционально)

Если хочешь нормальный домен с HTTPS (рекомендуется для камеры — `capture` требует secure context):

### Установка nginx

```bash
sudo apt-get install -y nginx
```

### Конфигурация nginx

```bash
sudo nano /etc/nginx/sites-available/honkai-chat
```

Вставь:

```nginx
server {
    listen 80;
    server_name chat.yourdomain.com;

    location / {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 86400;
    }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/honkai-chat /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

### SSL с Let's Encrypt

```bash
sudo apt-get install -y certbot python3-certbot-nginx
sudo certbot --nginx -d chat.yourdomain.com
```

Certbot автоматически обновит конфиг nginx и настроит автопродление.

---

## 6. Полезные команды

### На ВМ

```bash
# Логи приложения
pm2 logs honkai-chat

# Перезапуск
pm2 restart honkai-chat

# Остановка
pm2 stop honkai-chat

# Мониторинг (CPU/RAM)
pm2 monit

# Полный перезапуск с очисткой
pm2 delete honkai-chat
cd /opt/honkai-chat
pm2 start server/dist/index.js --name honkai-chat
pm2 save
```

### Обновление без CI

Если нужно обновить без GitHub Actions:

```bash
# На своём компьютере, в корне проекта
npm run build

# Скопировать на ВМ
rsync -avz --delete \
  package.json package-lock.json \
  shared/ server/package.json server/dist/ client/dist/ \
  deploy@<VM_HOST>:/opt/honkai-chat/

# На ВМ
ssh deploy@<VM_HOST>
cd /opt/honkai-chat
npm ci --omit=dev
pm2 restart honkai-chat
```

---

## Чеклист перед запуском

- [ ] ВМ создана и доступна по SSH
- [ ] Node.js 20 установлен на ВМ
- [ ] pm2 установлен и настроен с `pm2 startup`
- [ ] Директория `/opt/honkai-chat` создана с правами `deploy`
- [ ] Порт 3001 (или 80/443) открыт в группе безопасности
- [ ] GitHub Secrets настроены: `VM_HOST`, `VM_USER`, `VM_SSH_KEY`
- [ ] Push в `main` → workflow выполняется ✅
- [ ] Приложение доступно по `http://<VM_HOST>:3001`

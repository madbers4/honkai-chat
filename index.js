const express = require('express');

exports.handler = async (event, context) => {
    // Формируем простую HTML-страницу
    const html = `
    <!DOCTYPE html>
    <html>
    <head>
        <title>Сайт на Yandex Cloud Functions</title>
        <meta charset="utf-8" />
        <style>
            body { font-family: sans-serif; text-align: center; margin-top: 50px; background-color: #f0f0f0; }
            h1 { color: #333; }
        </style>
    </head>
    <body>
        <h1>Привет из автоматического деплоя! 🚀</h1>
        <p>Эта версия сайта обновляется при каждом push в GitHub.</p>
    </body>
    </html>
    `;

    return {
        statusCode: 200,
        headers: {
            'Content-Type': 'text/html; charset=utf-8'
        },
        body: html,
        isBase64Encoded: false
    };
};
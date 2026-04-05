' BOT 7CODE - INICIAR COM PAINEL WEB
' Abre o painel automaticamente no Chrome

Set WshShell = CreateObject("WScript.Shell")

' Para processos existentes
WshShell.Run "cmd.exe /c cd /d C:\Users\jp762\Desktop\7code-bot & pm2 stop 7code-bot >nul 2>nul & pm2 delete 7code-bot >nul 2>nul", 0, True

' Inicia o bot com PM2
WshShell.Run "cmd.exe /c cd /d C:\Users\jp762\Desktop\7code-bot & pm2 start src/index.js --name ""7code-bot"" & pm2 save", 0, True

' Aguarda 3 segundos e abre o navegador
WScript.Sleep 3000

' Abre o painel no Chrome
WshShell.Run "chrome.exe http://localhost:3000", 1, False

' Mostra mensagem de confirmação
WshShell.Run "cmd.exe /k cd /d C:\Users\jp762\Desktop\7code-bot & echo ======================================== & echo     BOT 7CODE COM PAINEL WEB & echo ======================================== & echo. & echo ✅ Bot iniciado! & echo 🌐 Painel aberto no Chrome: http://localhost:3000 & echo. & echo Para ver os logs: pm2 logs 7code-bot & echo. & pause", 1, False
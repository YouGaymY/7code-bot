const express = require('express');
const http = require('http');
const socketIO = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIO(server);

// Armazenar logs em memória
const logs = [];
const MAX_LOGS = 1000;

// Servir arquivos estáticos
app.use(express.static(path.join(__dirname, 'public')));
app.use('/logo.jpeg', express.static(path.join(__dirname, '..', 'logo.jpeg')));

// Health check para Railway
app.get('/health', (req, res) => {
    res.status(200).json({ 
        status: 'ok', 
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        version: '3.0'
    });
});

// Rota principal
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// API para obter logs recentes
app.get('/api/logs', (req, res) => {
    res.json({ logs: logs.slice(-200) });
});

// API para deletar logs
app.delete('/api/logs', (req, res) => {
    logs.length = 0;
    res.json({ success: true });
});

// API para status do bot
app.get('/api/status', (req, res) => {
    res.json({
        status: 'online',
        versao: '3.0',
        limite: 'R$ 15.000,00',
        taxa: '25%',
        timestamp: new Date().toISOString()
    });
});

// Função para adicionar log
function addLog(tipo, mensagem, dados = null) {
    const log = {
        id: Date.now(),
        timestamp: new Date().toISOString(),
        tipo: tipo,
        mensagem: mensagem,
        dados: dados
    };
    
    logs.unshift(log);
    if (logs.length > MAX_LOGS) logs.pop();
    
    io.emit('newLog', log);
    return log;
}

// Iniciar servidor
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`🌐 Painel web: http://localhost:${PORT}`);
    console.log(`✅ Health check: http://localhost:${PORT}/health`);
});

module.exports = { addLog, io };
const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const axios = require('axios');
const QRCode = require('qrcode');
const path = require('path');
const fs = require('fs');

// Configuração
const PODPAY_API_URL = 'https://api.podpay.app/v1/transactions';
const PODPAY_WITHDRAW_URL = 'https://api.podpay.app/v1/withdrawals';
const PODPAY_SECRET_KEY = process.env.PODPAY_SECRET_KEY || '';
const CPF_PADRAO = '00450402738';
const NOME_CLIENTE_API = 'MAX MAURO DA SILVA ARARIBA';
const TAXA_BOT = 0.25; // 25% de taxa
const ADM_CONTATO = '@17992418961'; // Contato do administrador

// Caminhos persistentes para Railway
const SESSION_DIR = process.env.SESSION_DIR || './session';
const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'database.sqlite');

// Garantir que diretório de sessão existe
if (!fs.existsSync(SESSION_DIR)) {
    fs.mkdirSync(SESSION_DIR, { recursive: true });
}

// Caminho das imagens
const IMAGEM_CONFIRMACAO_PAGAMENTO = path.join(__dirname, '..', 'pagamento.png');
const IMAGEM_CONFIRMACAO_SAQUE = path.join(__dirname, '..', 'saque.png');

// URLs do painel (apenas para admin)
const PAINEL_URL = process.env.PAINEL_URL || 'http://localhost:3000';

// Banco de dados
let db = null;
let getOrCreateUser, updateUser, registrarTransacaoPix, updateTransacaoPixStatus;
let registrarSaque, updateSaqueStatus, savePixKey, getDashboard, deleteUser;

// Armazenar transações ativas e intervalos
const transacoesAtivas = new Map();
const intervalosAtivos = new Map();
const saquesAtivos = new Map();
const intervalosSaque = new Map();
const usuariosEstado = new Map();

// Painel Web
let addLog = null;

try {
    const server = require('./server.js');
    addLog = server.addLog;
    console.log(`✅ Painel web carregado! ${PAINEL_URL}`);
} catch (error) {
    console.log('⚠️ Painel web não disponível, continuando sem ele...');
}

function enviarLog(tipo, mensagem, dados = null) {
    const logMsg = `[${tipo.toUpperCase()}] ${mensagem}`;
    console.log(logMsg);
    if (addLog) {
        addLog(tipo, mensagem, dados);
    }
}

async function initDatabase() {
    try {
        const database = require('./database.js');
        db = await database.initializeDatabase();
        getOrCreateUser = database.getOrCreateUser;
        updateUser = database.updateUser;
        registrarTransacaoPix = database.registrarTransacaoPix;
        updateTransacaoPixStatus = database.updateTransacaoPixStatus;
        registrarSaque = database.registrarSaque;
        updateSaqueStatus = database.updateSaqueStatus;
        savePixKey = database.savePixKey;
        getDashboard = database.getDashboard;
        deleteUser = database.deleteUser;
        enviarLog('success', '✅ Banco de dados inicializado com sucesso!');
    } catch (error) {
        enviarLog('error', `❌ Erro ao inicializar banco de dados: ${error.message}`);
    }
}

const client = new Client({
    authStrategy: new LocalAuth({
        dataPath: SESSION_DIR
    }),
    puppeteer: {
        headless: true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--disable-gpu'
        ]
    }
});

function converterValor(valor) {
    let valorStr = valor.toString().trim();
    valorStr = valorStr.replace(/R\$/i, '').trim();
    
    if (valorStr.includes('.') && valorStr.includes(',')) {
        valorStr = valorStr.replace(/\./g, '');
        valorStr = valorStr.replace(',', '.');
    }
    else if (valorStr.includes(',')) {
        valorStr = valorStr.replace(',', '.');
    }
    else if (valorStr.includes('.')) {
        valorStr = valorStr.replace(/\./g, '');
    }
    
    let valorNum = parseFloat(valorStr);
    
    if (isNaN(valorNum)) {
        let numeros = valorStr.replace(/[^0-9,]/g, '');
        numeros = numeros.replace(',', '.');
        valorNum = parseFloat(numeros);
    }
    
    return valorNum;
}

function formatarExibicao(valor) {
    return valor.toLocaleString('pt-BR', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    });
}

async function gerarImagemQRCode(texto) {
    try {
        if (!texto || texto.length < 10) return null;
        const qrCodeDataURL = await QRCode.toDataURL(texto, {
            errorCorrectionLevel: 'H',
            margin: 2,
            scale: 8,
            color: { dark: '#000000', light: '#FFFFFF' }
        });
        return qrCodeDataURL;
    } catch (error) {
        enviarLog('error', `Erro ao gerar imagem QR Code: ${error.message}`);
        return null;
    }
}

async function enviarImagemConfirmacaoPagamento(chat, valorFormatado, transactionId, nomeCliente) {
    try {
        if (fs.existsSync(IMAGEM_CONFIRMACAO_PAGAMENTO)) {
            const media = MessageMedia.fromFilePath(IMAGEM_CONFIRMACAO_PAGAMENTO);
            await chat.sendMessage(media, { 
                caption: `🎉 *PAGAMENTO CONFIRMADO COM SUCESSO!* 🎉\n\n` +
                        `✅ *Valor:* R$ ${valorFormatado}\n` +
                        `🆔 *Transação:* ${transactionId}\n` +
                        `👤 *Cliente:* ${nomeCliente}\n` +
                        `⏰ *Confirmado em:* ${new Date().toLocaleString('pt-BR')}\n\n` +
                        `💚 *O pagamento foi aprovado e confirmado!*\n\n` +
                        `✨ *Obrigado por usar o 7CODE!* ✨`
            });
            enviarLog('success', `Imagem de confirmação de pagamento enviada para ${nomeCliente}`);
        } else {
            const mensagemConfirmacao = `🎉 *PAGAMENTO CONFIRMADO COM SUCESSO!* 🎉\n\n` +
                                       `✅ *Valor:* R$ ${valorFormatado}\n` +
                                       `🆔 *Transação:* ${transactionId}\n` +
                                       `👤 *Cliente:* ${nomeCliente}\n` +
                                       `⏰ *Confirmado em:* ${new Date().toLocaleString('pt-BR')}\n\n` +
                                       `💚 *O pagamento foi aprovado e confirmado!*\n\n` +
                                       `✨ *Obrigado por usar o 7CODE!* ✨`;
            await chat.sendMessage(mensagemConfirmacao);
            enviarLog('success', `Confirmação de pagamento enviada para ${nomeCliente}`);
        }
    } catch (error) {
        enviarLog('error', `Erro ao enviar confirmação de pagamento: ${error.message}`);
        const mensagemConfirmacao = `🎉 *PAGAMENTO CONFIRMADO COM SUCESSO!* 🎉\n\n` +
                                   `✅ *Valor:* R$ ${valorFormatado}\n` +
                                   `🆔 *Transação:* ${transactionId}\n` +
                                   `👤 *Cliente:* ${nomeCliente}\n` +
                                   `⏰ *Confirmado em:* ${new Date().toLocaleString('pt-BR')}\n\n` +
                                   `💚 *O pagamento foi aprovado e confirmado!*\n\n` +
                                   `✨ *Obrigado por usar o 7CODE!* ✨`;
        await chat.sendMessage(mensagemConfirmacao);
    }
}

async function enviarImagemConfirmacaoSaque(chat, valor, withdrawalId, pixKey, pixKeyType, completedAt) {
    try {
        if (fs.existsSync(IMAGEM_CONFIRMACAO_SAQUE)) {
            const media = MessageMedia.fromFilePath(IMAGEM_CONFIRMACAO_SAQUE);
            await chat.sendMessage(media, { 
                caption: `🎉 *SAQUE CONFIRMADO COM SUCESSO!* 🎉\n\n` +
                        `✅ *Valor:* R$ ${formatarExibicao(valor)}\n` +
                        `🆔 *ID Saque:* ${withdrawalId}\n` +
                        `💳 *Chave PIX:* ${pixKey}\n` +
                        `📌 *Tipo:* ${pixKeyType}\n` +
                        `⏰ *Confirmado em:* ${new Date(completedAt).toLocaleString('pt-BR')}\n\n` +
                        `💚 *O saque foi aprovado e confirmado!*\n\n` +
                        `✨ *O valor já está a caminho da sua conta!* ✨`
            });
            enviarLog('success', `Imagem de confirmação de saque enviada para ${withdrawalId}`);
        } else {
            const mensagemConfirmacao = `🎉 *SAQUE CONFIRMADO COM SUCESSO!* 🎉\n\n` +
                                       `✅ *Valor:* R$ ${formatarExibicao(valor)}\n` +
                                       `🆔 *ID Saque:* ${withdrawalId}\n` +
                                       `💳 *Chave PIX:* ${pixKey}\n` +
                                       `📌 *Tipo:* ${pixKeyType}\n` +
                                       `⏰ *Confirmado em:* ${new Date(completedAt).toLocaleString('pt-BR')}\n\n` +
                                       `💚 *O saque foi aprovado e confirmado!*\n\n` +
                                       `✨ *O valor já está a caminho da sua conta!* ✨`;
            await chat.sendMessage(mensagemConfirmacao);
            enviarLog('success', `Confirmação de saque enviada para ${withdrawalId}`);
        }
    } catch (error) {
        enviarLog('error', `Erro ao enviar imagem de saque: ${error.message}`);
        const mensagemConfirmacao = `🎉 *SAQUE CONFIRMADO COM SUCESSO!* 🎉\n\n` +
                                   `✅ *Valor:* R$ ${formatarExibicao(valor)}\n` +
                                   `🆔 *ID Saque:* ${withdrawalId}\n` +
                                   `💳 *Chave PIX:* ${pixKey}\n` +
                                   `📌 *Tipo:* ${pixKeyType}\n` +
                                   `⏰ *Confirmado em:* ${new Date(completedAt).toLocaleString('pt-BR')}\n\n` +
                                   `💚 *O saque foi aprovado e confirmado!*\n\n` +
                                   `✨ *O valor já está a caminho da sua conta!* ✨`;
        await chat.sendMessage(mensagemConfirmacao);
    }
}

async function verificarStatusPagamento(transactionId) {
    try {
        const response = await axios.get(`${PODPAY_API_URL}/${transactionId}`, {
            headers: { 'x-api-key': PODPAY_SECRET_KEY },
            timeout: 10000
        });
        if (response.data && response.data.success) {
            return {
                sucesso: true,
                status: response.data.data.status,
                valor: response.data.data.amount / 100,
                valorFormatado: formatarExibicao(response.data.data.amount / 100),
                id: response.data.data.id,
                createdAt: response.data.data.createdAt
            };
        }
        return { sucesso: false };
    } catch (error) {
        enviarLog('error', `Erro ao verificar pagamento ${transactionId}: ${error.message}`);
        return { sucesso: false };
    }
}

async function verificarStatusSaque(withdrawalId) {
    try {
        const response = await axios.get(`${PODPAY_WITHDRAW_URL}/${withdrawalId}`, {
            headers: { 'x-api-key': PODPAY_SECRET_KEY },
            timeout: 10000
        });
        
        if (response.data && response.data.success) {
            return {
                sucesso: true,
                status: response.data.data.status,
                amount: response.data.data.amount / 100,
                fee: response.data.data.fee / 100,
                netAmount: response.data.data.netAmount / 100,
                createdAt: response.data.data.createdAt,
                completedAt: response.data.data.completedAt,
                id: response.data.data.id
            };
        }
        return { sucesso: false };
    } catch (error) {
        enviarLog('error', `Erro ao verificar saque ${withdrawalId}: ${error.message}`);
        return { sucesso: false };
    }
}

async function iniciarVerificacaoAutomaticaPagamento(transactionId, chatId, nomeCliente, valorFormatado, userId, valorBruto) {
    let tentativas = 0;
    const maxTentativas = 540;
    
    enviarLog('info', `Iniciando verificação automática de pagamento para ${nomeCliente}`, { id: transactionId, valor: valorFormatado });
    
    const intervalo = setInterval(async () => {
        tentativas++;
        if (!transacoesAtivas.has(transactionId)) {
            if (intervalosAtivos.has(transactionId)) {
                clearInterval(intervalosAtivos.get(transactionId));
                intervalosAtivos.delete(transactionId);
            }
            return;
        }
        
        if (tentativas % 10 === 0) {
            enviarLog('info', `Verificando pagamento ${transactionId}... (tentativa ${tentativas}/${maxTentativas})`);
        }
        
        const status = await verificarStatusPagamento(transactionId);
        
        if (status.sucesso && status.status === 'paid') {
            enviarLog('confirm', `✅ PAGAMENTO CONFIRMADO!`, { id: transactionId, valor: valorFormatado, cliente: nomeCliente });
            
            if (db && userId) {
                const { valorLiquido, novoSaldo } = await registrarTransacaoPix(transactionId, userId, valorBruto, TAXA_BOT);
                enviarLog('success', `💰 Saldo atualizado: R$ ${formatarExibicao(novoSaldo)} (Líquido: R$ ${formatarExibicao(valorLiquido)})`);
            }
            
            transacoesAtivas.delete(transactionId);
            if (intervalosAtivos.has(transactionId)) {
                clearInterval(intervalosAtivos.get(transactionId));
                intervalosAtivos.delete(transactionId);
            }
            
            try {
                const chat = await client.getChatById(chatId);
                if (chat) {
                    await enviarImagemConfirmacaoPagamento(chat, valorFormatado, transactionId, nomeCliente);
                }
            } catch (error) {
                enviarLog('error', `Erro ao enviar confirmação de pagamento: ${error.message}`);
            }
        } else if (tentativas >= maxTentativas) {
            enviarLog('warning', `Tempo esgotado para pagamento ${transactionId} (1 hora e 30 minutos)`);
            transacoesAtivas.delete(transactionId);
            if (intervalosAtivos.has(transactionId)) {
                clearInterval(intervalosAtivos.get(transactionId));
                intervalosAtivos.delete(transactionId);
            }
        }
    }, 10000);
    
    intervalosAtivos.set(transactionId, intervalo);
}

async function iniciarVerificacaoAutomaticaSaque(withdrawalId, chatId, userId, valor, pixKey, pixKeyType) {
    let tentativas = 0;
    const maxTentativas = 180; // 30 minutos
    
    enviarLog('info', `🔄 Iniciando verificação automática de saque ${withdrawalId}`, { valor: formatarExibicao(valor) });
    
    const intervalo = setInterval(async () => {
        tentativas++;
        
        if (!saquesAtivos.has(withdrawalId)) {
            if (intervalosSaque.has(withdrawalId)) {
                clearInterval(intervalosSaque.get(withdrawalId));
                intervalosSaque.delete(withdrawalId);
            }
            return;
        }
        
        if (tentativas % 6 === 0) {
            enviarLog('info', `🔍 Verificando saque ${withdrawalId}... (tentativa ${tentativas}/${maxTentativas})`);
        }
        
        const status = await verificarStatusSaque(withdrawalId);
        
        if (status.sucesso && (status.status === 'completed' || status.status === 'paid')) {
            enviarLog('confirm', `✅ SAQUE CONFIRMADO!`, { id: withdrawalId, valor: formatarExibicao(valor), status: status.status });
            
            if (db) {
                await updateSaqueStatus(withdrawalId, 'completed', status.fee, status.netAmount);
            }
            
            saquesAtivos.delete(withdrawalId);
            if (intervalosSaque.has(withdrawalId)) {
                clearInterval(intervalosSaque.get(withdrawalId));
                intervalosSaque.delete(withdrawalId);
            }
            
            try {
                const chat = await client.getChatById(chatId);
                if (chat) {
                    await enviarImagemConfirmacaoSaque(chat, valor, withdrawalId, pixKey, pixKeyType, status.completedAt || new Date().toISOString());
                }
            } catch (error) {
                enviarLog('error', `Erro ao enviar confirmação de saque: ${error.message}`);
            }
            
        } else if (status.sucesso && status.status === 'failed') {
            enviarLog('error', `❌ SAQUE FALHOU!`, { id: withdrawalId, valor: formatarExibicao(valor) });
            
            if (db) {
                await updateSaqueStatus(withdrawalId, 'failed', status.fee, status.netAmount);
            }
            
            saquesAtivos.delete(withdrawalId);
            if (intervalosSaque.has(withdrawalId)) {
                clearInterval(intervalosSaque.get(withdrawalId));
                intervalosSaque.delete(withdrawalId);
            }
            
            try {
                const chat = await client.getChatById(chatId);
                if (chat) {
                    await chat.sendMessage(`❌ *SAQUE FALHOU!* ❌\n\n` +
                                          `💰 *Valor:* R$ ${formatarExibicao(valor)}\n` +
                                          `🆔 *ID Saque:* ${withdrawalId}\n\n` +
                                          `⚠️ *O saque não foi processado. Tente novamente mais tarde.*\n\n` +
                                          `📞 *Contate o administrador:* ${ADM_CONTATO}`);
                }
            } catch (error) {
                enviarLog('error', `Erro ao enviar falha de saque: ${error.message}`);
            }
            
        } else if (tentativas >= maxTentativas) {
            enviarLog('warning', `⏰ Tempo esgotado para saque ${withdrawalId} (30 minutos)`);
            saquesAtivos.delete(withdrawalId);
            if (intervalosSaque.has(withdrawalId)) {
                clearInterval(intervalosSaque.get(withdrawalId));
                intervalosSaque.delete(withdrawalId);
            }
        }
    }, 10000);
    
    intervalosSaque.set(withdrawalId, intervalo);
}

async function criarSaqueAPI(valor, pixKey, pixKeyType) {
    try {
        const valorCentavos = Math.round(valor * 100);
        const payload = {
            method: 'fiat',
            amount: valorCentavos,
            pixKey: pixKey,
            pixKeyType: pixKeyType,
            netPayout: false
        };
        const response = await axios.post(PODPAY_WITHDRAW_URL, payload, {
            headers: { 'Content-Type': 'application/json', 'x-api-key': PODPAY_SECRET_KEY },
            timeout: 30000
        });
        if (response.data && response.data.success) {
            return {
                sucesso: true,
                withdrawalId: response.data.data.id,
                status: response.data.data.status,
                amount: response.data.data.amount / 100,
                fee: response.data.data.fee / 100,
                netAmount: response.data.data.netAmount / 100
            };
        }
        return { sucesso: false, erro: 'Erro ao criar saque' };
    } catch (error) {
        enviarLog('error', `Erro ao criar saque: ${error.response?.data || error.message}`);
        return { sucesso: false, erro: error.response?.data?.message || 'Erro na conexão' };
    }
}

async function gerarPix(valor, nomeClienteWhatsApp, chatId, userId) {
    try {
        let valorNum = converterValor(valor);
        if (isNaN(valorNum) || valorNum <= 0) return { erro: `❌ Valor inválido: "${valor}"` };
        if (valorNum < 1) return { erro: '❌ Valor mínimo é R$ 1,00' };
        if (valorNum > 15000) return { erro: `❌ Valor máximo é R$ 15.000,00` };
        
        let valorCentavos = Math.round(valorNum * 100);
        const valorLiquido = valorNum * (1 - TAXA_BOT);
        
        const payload = {
            paymentMethod: 'pix',
            postbackUrl: 'https://seu-site.com/webhook',
            customer: {
                document: { type: 'cpf', number: CPF_PADRAO },
                name: NOME_CLIENTE_API,
                email: 'cliente@email.com',
                phone: '11999999999'
            },
            amount: valorCentavos,
            items: [{
                title: `Pagamento 7Code - R$ ${formatarExibicao(valorNum)}`,
                unitPrice: valorCentavos,
                quantity: 1,
                tangible: false
            }]
        };
        
        enviarLog('payment', `💰 Gerando PIX de R$ ${formatarExibicao(valorNum)} para ${nomeClienteWhatsApp} (Líquido: R$ ${formatarExibicao(valorLiquido)})`);
        
        const response = await axios.post(PODPAY_API_URL, payload, {
            headers: { 'Content-Type': 'application/json', 'x-api-key': PODPAY_SECRET_KEY },
            timeout: 30000
        });
        
        if (response.data && response.data.success) {
            const qrCodeTexto = response.data.data?.pixQrCode;
            if (!qrCodeTexto || qrCodeTexto.length < 50) return { erro: '❌ QR Code não retornado. Tente novamente.' };
            
            const transactionId = response.data.data.id;
            const valorFormatado = formatarExibicao(valorNum);
            
            transacoesAtivas.set(transactionId, {
                chatId: chatId,
                nomeCliente: nomeClienteWhatsApp,
                valorFormatado: valorFormatado,
                criadoEm: new Date()
            });
            
            iniciarVerificacaoAutomaticaPagamento(transactionId, chatId, nomeClienteWhatsApp, valorFormatado, userId, valorNum);
            
            return {
                sucesso: true,
                valor: valorNum,
                valorLiquido: valorLiquido,
                valorFormatado: valorFormatado,
                qrCode: qrCodeTexto,
                qrCodeImage: response.data.data?.pixQrCodeImage,
                id: transactionId,
                status: response.data.data.status
            };
        }
        return { erro: '❌ Erro ao gerar pagamento. Tente novamente.' };
    } catch (error) {
        enviarLog('error', `Erro ao gerar PIX: ${error.response?.data || error.message}`);
        if (error.response?.status === 401) return { erro: '❌ Chave da API inválida.' };
        return { erro: '❌ Erro de conexão. Tente novamente.' };
    }
}

async function processarCadastro(message, chat, userId, nome, numero, faturamento) {
    try {
        let numeroWhatsApp = numero;
        if (!numeroWhatsApp || numeroWhatsApp === 'undefined') {
            const contact = await message.getContact();
            numeroWhatsApp = contact.number || message.author || message.from;
        }
        if (!numeroWhatsApp || numeroWhatsApp === 'undefined') {
            numeroWhatsApp = userId;
        }
        numeroWhatsApp = numeroWhatsApp.replace(/@c\.us|@lid/g, '');
        
        const usuario = await getOrCreateUser(userId, nome, numeroWhatsApp);
        
        if (faturamento && !isNaN(parseFloat(faturamento))) {
            await updateUser(userId, { faturamento_mensal: parseFloat(faturamento) });
        }
        
        const dashboard = await getDashboard(userId);
        
        const mensagem = `✅ *CADASTRO REALIZADO COM SUCESSO!*\n\n` +
                        `👤 *Nome:* ${dashboard.nome}\n` +
                        `🆔 *Seu código:* ${dashboard.codigo}\n` +
                        `📱 *WhatsApp:* ${dashboard.numero_whatsapp}\n` +
                        `💰 *Faturamento mensal:* R$ ${formatarExibicao(dashboard.faturamento_mensal || 0)}\n\n` +
                        `💡 *Use /dashboard para ver suas informações*\n` +
                        `💡 *Use /email para cadastrar sua chave PIX*\n` +
                        `💡 *Use /saque [valor] para sacar seu saldo*\n` +
                        `💡 *Use /excluir para deletar sua conta*`;
        
        await message.reply(mensagem);
        enviarLog('success', `Novo cadastro: ${nome} (${dashboard.codigo})`);
    } catch (error) {
        enviarLog('error', `Erro no cadastro: ${error.message}`);
        await message.reply('❌ *ERRO NO CADASTRO*\n\nTente novamente mais tarde.');
    }
}

async function mostrarDashboard(message, userId) {
    try {
        const dashboard = await getDashboard(userId);
        if (!dashboard) {
            await message.reply('❌ *USUÁRIO NÃO CADASTRADO*\n\nUse `/cadastro` para criar sua conta.');
            return;
        }
        const mensagem = `📊 *SEU DASHBOARD - 7CODE* 📊\n\n` +
                        `👤 *Nome:* ${dashboard.nome}\n` +
                        `🆔 *Código:* ${dashboard.codigo}\n` +
                        `━━━━━━━━━━━━━━━━━━━━━━\n` +
                        `💰 *Saldo disponível:* R$ ${formatarExibicao(dashboard.saldo_disponivel || 0)}\n` +
                        `📈 *Total recebido:* R$ ${formatarExibicao(dashboard.total_recebido || 0)}\n` +
                        `📤 *Total sacado:* R$ ${formatarExibicao(dashboard.total_sacado || 0)}\n` +
                        `🎫 *Ticket médio:* R$ ${formatarExibicao(dashboard.ticket_medio || 0)}\n` +
                        `🔄 *Transações:* ${dashboard.numero_transacoes || 0}\n` +
                        `━━━━━━━━━━━━━━━━━━━━━━\n` +
                        `💳 *Chave PIX:* ${dashboard.pix_key || 'Não cadastrada'}\n` +
                        `📌 *Tipo da chave:* ${dashboard.pix_key_type || '-'}\n\n` +
                        `💡 *Comandos:*\n` +
                        `   /saque [valor] - Sacar saldo\n` +
                        `   /email [chave] - Cadastrar chave PIX\n` +
                        `   /qr [valor] - Gerar pagamento\n` +
                        `   /excluir - Excluir sua conta`;
        await message.reply(mensagem);
        enviarLog('info', `Dashboard exibido para ${dashboard.nome}`);
    } catch (error) {
        enviarLog('error', `Erro ao mostrar dashboard: ${error.message}`);
        await message.reply('❌ *ERRO AO CARREGAR DASHBOARD*\n\nTente novamente mais tarde.');
    }
}

async function processarExcluirConta(message, userId) {
    try {
        const dashboard = await getDashboard(userId);
        if (!dashboard) {
            await message.reply('❌ *USUÁRIO NÃO CADASTRADO*\n\nUse `/cadastro` para criar sua conta.');
            return;
        }
        
        if (dashboard.saldo_disponivel > 0) {
            await message.reply(`⚠️ *ATENÇÃO!* ⚠️\n\n` +
                               `Você possui saldo disponível de R$ ${formatarExibicao(dashboard.saldo_disponivel)}.\n\n` +
                               `Antes de excluir sua conta, você precisa sacar todo o saldo.\n\n` +
                               `Use /saque ${formatarExibicao(dashboard.saldo_disponivel)} para sacar seu saldo primeiro.`);
            return;
        }
        
        usuariosEstado.set(userId, { acao: 'aguardando_confirmacao_excluir' });
        await message.reply(`⚠️ *CONFIRMAÇÃO DE EXCLUSÃO DE CONTA* ⚠️\n\n` +
                           `👤 *Nome:* ${dashboard.nome}\n` +
                           `🆔 *Código:* ${dashboard.codigo}\n\n` +
                           `⚠️ *ATENÇÃO!* Esta ação é IRREVERSÍVEL!\n` +
                           `Todos os seus dados serão permanentemente deletados.\n\n` +
                           `Digite *CONFIRMAR* para excluir sua conta.\n` +
                           `Ou digite *CANCELAR* para cancelar.`);
    } catch (error) {
        enviarLog('error', `Erro ao processar exclusão: ${error.message}`);
        await message.reply('❌ *ERRO AO EXCLUIR CONTA*\n\nTente novamente mais tarde.');
    }
}

async function processarSaque(message, chat, userId, valor, pixKey, pixKeyType) {
    try {
        const dashboard = await getDashboard(userId);
        if (!dashboard) {
            await message.reply('❌ *USUÁRIO NÃO CADASTRADO*\n\nUse `/cadastro` para criar sua conta.');
            return false;
        }
        
        const valorSaque = parseFloat(valor);
        if (isNaN(valorSaque) || valorSaque <= 0) {
            await message.reply('❌ *VALOR INVÁLIDO*\n\nUse: `/saque 100,00`');
            return false;
        }
        
        if (valorSaque > dashboard.saldo_disponivel) {
            await message.reply(`❌ *SALDO INSUFICIENTE*\n\nSeu saldo disponível é R$ ${formatarExibicao(dashboard.saldo_disponivel)}`);
            return false;
        }
        
        await message.reply(`⚠️ *ATENÇÃO - FILA DE SAQUE* ⚠️\n\n` +
                           `Devido ao alto volume de solicitações, seu saque pode demorar alguns minutos para ser processado.\n\n` +
                           `✅ *Seu saque foi solicitado e está na fila!*\n` +
                           `🔄 A confirmação é automática - você receberá uma notificação quando for processado.\n\n` +
                           `📞 *Caso não caia em até 30 minutos, contate o administrador:* ${ADM_CONTATO}\n\n` +
                           `⏳ *Aguardando confirmação do saque...*`);
        
        const saque = await criarSaqueAPI(valorSaque, pixKey, pixKeyType);
        
        if (!saque.sucesso) {
            await message.reply(`❌ *ERRO NO SAQUE*\n\n${saque.erro || 'Tente novamente mais tarde.'}`);
            return false;
        }
        
        await registrarSaque(saque.withdrawalId, userId, valorSaque, pixKey, pixKeyType);
        
        const chatId = chat.id._serialized;
        saquesAtivos.set(saque.withdrawalId, {
            chatId: chatId,
            userId: userId,
            valor: valorSaque,
            pixKey: pixKey,
            pixKeyType: pixKeyType,
            criadoEm: new Date()
        });
        
        iniciarVerificacaoAutomaticaSaque(saque.withdrawalId, chatId, userId, valorSaque, pixKey, pixKeyType);
        
        const mensagem = `✅ *SAQUE SOLICITADO COM SUCESSO!* ✅\n\n` +
                        `💰 *Valor:* R$ ${formatarExibicao(valorSaque)}\n` +
                        `💳 *Chave PIX:* ${pixKey}\n` +
                        `📌 *Tipo:* ${pixKeyType}\n` +
                        `🆔 *ID Saque:* ${saque.withdrawalId}\n` +
                        `⏳ *Status:* ${saque.status}\n\n` +
                        `🔄 *A confirmação é AUTOMÁTICA!* O bot avisará quando o saque for processado.\n\n` +
                        `✨ *O valor será creditado em breve!* ✨`;
        
        await message.reply(mensagem);
        enviarLog('success', `Saque solicitado: R$ ${formatarExibicao(valorSaque)} para ${dashboard.nome} - ID: ${saque.withdrawalId}`);
        
        return true;
    } catch (error) {
        enviarLog('error', `Erro no saque: ${error.message}`);
        await message.reply('❌ *ERRO NO SAQUE*\n\nTente novamente mais tarde.');
        return false;
    }
}

// Função para cadastrar chave - sem confirmação
async function processarChave(message, userId, pixKey, pixKeyType) {
    try {
        const dashboard = await getDashboard(userId);
        const chaveAtual = dashboard?.pix_key;
        
        await savePixKey(userId, pixKey, pixKeyType);
        
        let mensagem;
        if (chaveAtual) {
            mensagem = `✅ *CHAVE PIX ATUALIZADA COM SUCESSO!* ✅\n\n` +
                      `🔄 *Chave antiga:* ${chaveAtual}\n` +
                      `📌 *Tipo antigo:* ${dashboard.pix_key_type}\n\n` +
                      `💳 *Nova chave:* ${pixKey}\n` +
                      `📌 *Novo tipo:* ${pixKeyType}\n\n` +
                      `💡 *Agora você pode usar /saque [valor] para sacar seu saldo!*`;
        } else {
            mensagem = `✅ *CHAVE PIX CADASTRADA COM SUCESSO!* ✅\n\n` +
                      `💳 *Chave:* ${pixKey}\n` +
                      `📌 *Tipo:* ${pixKeyType}\n\n` +
                      `💡 *Agora você pode usar /saque [valor] para sacar seu saldo!*`;
        }
        
        await message.reply(mensagem);
        enviarLog('success', `Chave PIX ${chaveAtual ? 'atualizada' : 'cadastrada'} para ${userId}: ${pixKey}`);
    } catch (error) {
        enviarLog('error', `Erro ao cadastrar chave: ${error.message}`);
        await message.reply('❌ *ERRO AO CADASTRAR CHAVE*\n\nTente novamente mais tarde.');
    }
}

function calcularExpressao(expressao) {
    try {
        let expr = expressao.replace(/\s/g, '').replace(/,/g, '.');
        if (!/^[\d+\-*/%.()]+$/.test(expr)) return null;
        const resultado = Function('"use strict";return (' + expr + ')')();
        if (isNaN(resultado) || !isFinite(resultado)) return null;
        return resultado;
    } catch (error) {
        return null;
    }
}

async function enviarMensagemComQRCode(message, pagamento) {
    try {
        const qrCodeImageBase64 = await gerarImagemQRCode(pagamento.qrCode);
        if (qrCodeImageBase64) {
            const media = new MessageMedia('image/png', qrCodeImageBase64.split(',')[1]);
            await message.reply(media, undefined, { 
                caption: `💰 *PAGAMENTO PIX - 7CODE* 💰\n\n` +
                        `✅ *Valor:* R$ ${pagamento.valorFormatado}\n` +
                        `💰 *Você receberá:* R$ ${formatarExibicao(pagamento.valorLiquido)} (após taxa de ${TAXA_BOT * 100}%)\n` +
                        `🆔 *ID:* ${pagamento.id}\n` +
                        `⏳ *Status:* ${pagamento.status}\n` +
                        `📱 *Escaneie o QR Code abaixo para pagar*\n\n` +
                        `🔄 *Confirmação AUTOMÁTICA!* O bot avisará quando for pago.\n\n` +
                        `✅ *Pagamento gerado com sucesso!* ✅` 
            });
            setTimeout(async () => { await message.reply(pagamento.qrCode); }, 1000);
            setTimeout(async () => { await message.reply(`/status ${pagamento.id}`); }, 2000);
        } else {
            const mensagem = `💰 *PAGAMENTO PIX - 7CODE* 💰\n\n` +
                           `✅ *Valor:* R$ ${pagamento.valorFormatado}\n` +
                           `💰 *Você receberá:* R$ ${formatarExibicao(pagamento.valorLiquido)} (após taxa de ${TAXA_BOT * 100}%)\n` +
                           `🆔 *ID:* ${pagamento.id}\n` +
                           `⏳ *Status:* ${pagamento.status}\n\n` +
                           `📱 *CÓDIGO PIX:*\n${pagamento.qrCode}\n\n` +
                           `🔄 *Confirmação AUTOMÁTICA!*\n\n` +
                           `/status ${pagamento.id}`;
            await message.reply(mensagem);
        }
    } catch (error) {
        enviarLog('error', `Erro ao enviar mensagem QR Code: ${error.message}`);
        const mensagem = `💰 *PAGAMENTO PIX - 7CODE* 💰\n\n` +
                       `✅ *Valor:* R$ ${pagamento.valorFormatado}\n` +
                       `💰 *Você receberá:* R$ ${formatarExibicao(pagamento.valorLiquido)} (após taxa de ${TAXA_BOT * 100}%)\n` +
                       `🆔 *ID:* ${pagamento.id}\n\n` +
                       `📱 *CÓDIGO PIX:*\n${pagamento.qrCode}\n\n` +
                       `/status ${pagamento.id}`;
        await message.reply(mensagem);
    }
}

client.on('qr', (qr) => {
    console.log('\n========================================');
    console.log('   📱 ESCANEIE O QR CODE COM SEU WHATSAPP');
    console.log('========================================\n');
    
    // Mostrar QR Code normal
    qrcode.generate(qr, { small: true });
    
    // Mostrar link alternativo para gerar QR Code online
    console.log('\n🔗 ALTERNATIVA: Copie o link abaixo e cole no navegador:');
    console.log(`https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(qr)}`);
    
    // Mostrar também o texto puro do QR Code (últimos 100 caracteres)
    console.log('\n📝 TEXTO DO QR CODE (copie e cole no gerador de QR Code):');
    console.log(qr.substring(0, 200) + '...');
    console.log('\n⏳ Aguardando escaneamento...\n');
    enviarLog('info', 'QR Code gerado, aguardando escaneamento');
});

client.on('ready', async () => {
    await initDatabase();
    console.log('\n========================================');
    console.log('   ✅ BOT 7CODE ESTÁ ONLINE!');
    console.log('========================================');
    console.log('\n📝 COMANDOS DISPONÍVEIS:');
    console.log('   💰 /qr [valor]           → Gerar PIX');
    console.log('   🎮 /jogo [valor]         → Gerar PIX');
    console.log('   📊 /dashboard            → Ver suas informações');
    console.log('   📝 /cadastro             → Criar sua conta');
    console.log('   💳 /email [chave]        → Cadastrar chave PIX');
    console.log('   💸 /saque [valor]        → Sacar saldo');
    console.log('   🗑️ /excluir              → Excluir sua conta');
    console.log('   🔍 /status saque [ID]    → Consultar status do saque');
    console.log('   🧮 /calculadora [conta]  → Calcular');
    console.log('   🔍 /status [ID]          → Consultar pagamento');
    console.log('   📊 /status               → Status do bot');
    console.log('   ❓ /ajuda                → Ajuda\n');
    console.log(`✅ CONFIRMAÇÃO AUTOMÁTICA ATIVA!`);
    console.log(`   Pagamento: a cada 10s por até 1h30`);
    console.log(`   Saque: a cada 10s por até 30 minutos\n`);
    console.log(`💰 TAXA DO BOT: ${TAXA_BOT * 100}%`);
    console.log(`👤 Nome cliente API: ${NOME_CLIENTE_API}`);
    console.log(`🆔 CPF API: ${CPF_PADRAO}`);
    console.log(`📞 Contato ADM: ${ADM_CONTATO}\n`);
    enviarLog('success', '✅ BOT 7CODE ESTÁ ONLINE!');
    enviarLog('info', `Taxa do bot: ${TAXA_BOT * 100}%`);
});

client.on('message', async (message) => {
    if (message.fromMe) return;
    const body = message.body.trim();
    const chat = await message.getChat();
    const comando = body.toLowerCase();
    const senderId = message.author || message.from;
    
    try {
        // Estados do usuário
        if (usuariosEstado.has(senderId)) {
            const estado = usuariosEstado.get(senderId);
            
            if (estado.acao === 'aguardando_confirmacao_saque') {
                const resposta = body.trim().toUpperCase();
                if (resposta === 'CONFIRMAR' || resposta === '/CONFIRMAR') {
                    const dashboard = await getDashboard(senderId);
                    if (dashboard && dashboard.pix_key) {
                        await processarSaque(message, chat, senderId, estado.valor, dashboard.pix_key, dashboard.pix_key_type);
                        usuariosEstado.delete(senderId);
                    }
                } else if (resposta === 'CANCELAR' || resposta === '/CANCELAR') {
                    usuariosEstado.delete(senderId);
                    await message.reply('❌ *SAQUE CANCELADO*');
                } else {
                    await message.reply('⚠️ *OPÇÃO INVÁLIDA*\n\nDigite *CONFIRMAR* para confirmar o saque ou *CANCELAR* para cancelar.');
                }
                return;
            }
            
            if (estado.acao === 'aguardando_confirmacao_excluir') {
                const resposta = body.trim().toUpperCase();
                if (resposta === 'CONFIRMAR' || resposta === '/CONFIRMAR') {
                    const deletado = await deleteUser(senderId);
                    if (deletado) {
                        await message.reply(`✅ *CONTA EXCLUÍDA COM SUCESSO!* ✅\n\n` +
                                           `Seus dados foram removidos permanentemente do sistema.\n\n` +
                                           `💡 *Caso queira voltar, use /cadastro para criar uma nova conta.*`);
                        enviarLog('success', `Conta excluída: ${senderId}`);
                    } else {
                        await message.reply('❌ *ERRO AO EXCLUIR CONTA*\n\nTente novamente mais tarde.');
                    }
                    usuariosEstado.delete(senderId);
                } else if (resposta === 'CANCELAR' || resposta === '/CANCELAR') {
                    usuariosEstado.delete(senderId);
                    await message.reply('❌ *EXCLUSÃO DE CONTA CANCELADA*');
                } else {
                    await message.reply('⚠️ *OPÇÃO INVÁLIDA*\n\nDigite *CONFIRMAR* para excluir sua conta ou *CANCELAR* para cancelar.');
                }
                return;
            }
            
            if (estado.acao === 'aguardando_cadastro_nome') {
                usuariosEstado.set(senderId, { acao: 'aguardando_cadastro_numero', nome: body, numeroWhatsApp: estado.numeroWhatsApp });
                await message.reply('📱 *NÚMERO DE WHATSAPP*\n\nDigite seu número com DDD (ex: 11999999999):');
                return;
            }
            if (estado.acao === 'aguardando_cadastro_numero') {
                usuariosEstado.set(senderId, { acao: 'aguardando_cadastro_faturamento', nome: estado.nome, numeroWhatsApp: body });
                await message.reply('💰 *FATURAMENTO MENSAL*\n\nDigite seu faturamento mensal aproximado (ex: 5000 ou 5.000,00):');
                return;
            }
            if (estado.acao === 'aguardando_cadastro_faturamento') {
                await processarCadastro(message, chat, senderId, estado.nome, estado.numeroWhatsApp, body);
                usuariosEstado.delete(senderId);
                return;
            }
        }
        
        // Comandos diretos de chave
        const tiposChave = ['email', 'cpf', 'cnpj', 'telefone', 'aleatoria'];
        for (const tipo of tiposChave) {
            if (comando.startsWith(`/${tipo} `)) {
                const chave = body.substring(tipo.length + 2).trim();
                if (chave) {
                    await processarChave(message, senderId, chave, tipo);
                } else {
                    await message.reply(`❌ *FORMATO INVÁLIDO*\n\nUse: /${tipo} sua_chave_aqui`);
                }
                return;
            }
        }
        
        // Comandos normais
        if (comando === '/excluir') {
            await processarExcluirConta(message, senderId);
            return;
        }
        
        if (comando.startsWith('/status saque ') || comando.startsWith('/statussaque ')) {
            let withdrawalId;
            if (comando.startsWith('/status saque ')) {
                withdrawalId = body.substring(14).trim();
            } else {
                withdrawalId = body.substring(13).trim();
            }
            if (withdrawalId && withdrawalId.length > 10) {
                const status = await verificarStatusSaque(withdrawalId);
                if (status.sucesso) {
                    let statusText = status.status === 'completed' ? 'COMPLETADO ✅' : 
                                    status.status === 'pending' ? 'PENDENTE ⏳' : 
                                    status.status === 'failed' ? 'FALHOU ❌' : status.status;
                    let mensagem = `🔍 *CONSULTA DE SAQUE*\n\n🆔 *ID:* ${status.id}\n💰 *Valor:* R$ ${formatarExibicao(status.amount)}\n📊 *Status:* ${statusText}\n📅 *Criado em:* ${new Date(status.createdAt).toLocaleString('pt-BR')}`;
                    if (status.completedAt) mensagem += `\n✅ *Concluído em:* ${new Date(status.completedAt).toLocaleString('pt-BR')}`;
                    await message.reply(mensagem);
                } else {
                    await message.reply(`❌ *ERRO NA CONSULTA*\n\nVerifique o ID do saque.`);
                }
            }
            return;
        }
        
        if (comando === '/dashboard') { await mostrarDashboard(message, senderId); return; }
        
        if (comando === '/cadastro') {
            const contact = await message.getContact();
            const numeroContato = contact.number || message.author || message.from;
            const numeroLimpo = numeroContato.replace(/@c\.us|@lid/g, '');
            usuariosEstado.set(senderId, { acao: 'aguardando_cadastro_nome', numeroWhatsApp: numeroLimpo });
            await message.reply('📝 *CADASTRO - 7CODE* 📝\n\nPara começar, digite seu *NOME COMPLETO*:');
            return;
        }
        
        if (comando.startsWith('/saque ')) {
            const valor = body.substring(7).trim();
            const dashboard = await getDashboard(senderId);
            if (!dashboard) {
                await message.reply('❌ *USUÁRIO NÃO CADASTRADO*\n\nUse `/cadastro` para criar sua conta primeiro.');
                return;
            }
            if (!dashboard.pix_key) {
                await message.reply('❌ *CHAVE PIX NÃO CADASTRADA*\n\nUse `/email seu@email.com` para cadastrar sua chave PIX primeiro.');
                return;
            }
            const valorNum = converterValor(valor);
            if (isNaN(valorNum) || valorNum <= 0) {
                await message.reply('❌ *VALOR INVÁLIDO*\n\nUse: `/saque 100,00`');
                return;
            }
            if (valorNum > dashboard.saldo_disponivel) {
                await message.reply(`❌ *SALDO INSUFICIENTE*\n\nSaldo disponível: R$ ${formatarExibicao(dashboard.saldo_disponivel)}`);
                return;
            }
            usuariosEstado.set(senderId, { acao: 'aguardando_confirmacao_saque', valor: valorNum });
            await message.reply(`⚠️ *CONFIRMAÇÃO DE SAQUE* ⚠️\n\n💰 *Valor:* R$ ${formatarExibicao(valorNum)}\n💳 *Chave:* ${dashboard.pix_key}\n📌 *Tipo:* ${dashboard.pix_key_type}\n\nDigite *CONFIRMAR* para confirmar o saque.\nOu digite *CANCELAR* para cancelar.`);
            return;
        }
        
        if (comando.startsWith('/calculadora ')) {
            const expressao = body.substring(13).trim();
            const resultado = calcularExpressao(expressao);
            if (resultado !== null) {
                await message.reply(`🧮 *CALCULADORA 7CODE*\n\n📝 *Expressão:* ${expressao}\n✅ *Resultado:* ${formatarExibicao(resultado)}`);
            } else {
                await message.reply('❌ *EXPRESSÃO INVÁLIDA*\n\nUse apenas números e operadores (+, -, *, /, %, .)');
            }
            return;
        }
        
        if (comando === '/status') {
            const dashboard = await getDashboard(senderId);
            const ativas = transacoesAtivas.size;
            await message.reply(`✅ *BOT 7CODE ATIVO*\n\n💰 *Sistema:* Pagamentos PIX\n💵 *Limite:* R$ 15.000,00\n💸 *Taxa:* ${TAXA_BOT * 100}%\n📊 *Transações ativas:* ${ativas}\n${dashboard ? `👤 *Conta:* ${dashboard.codigo}\n` : '📝 *Cadastre-se:* /cadastro\n'}📅 *Versão:* 3.0`);
            return;
        }
        
        if (comando.startsWith('/status ') && comando.length > 8 && !comando.includes('saque')) {
            const transactionId = body.substring(8).trim();
            if (transactionId && transactionId.length > 10) {
                const status = await verificarStatusPagamento(transactionId);
                if (status.sucesso) {
                    await message.reply(`🔍 *CONSULTA DE PAGAMENTO*\n\n🆔 *ID:* ${status.id}\n💰 *Valor:* R$ ${status.valorFormatado}\n📊 *Status:* ${status.status === 'paid' ? 'PAGO ✅' : 'PENDENTE ⏳'}\n📅 *Criado em:* ${new Date(status.createdAt).toLocaleString('pt-BR')}`);
                } else {
                    await message.reply(`❌ *ERRO NA CONSULTA*\n\nVerifique o ID da transação.`);
                }
            }
            return;
        }
        
        if (comando === '/ajuda' || comando === '/help') {
            const ajuda = `🤖 *7CODE - BOT DE PAGAMENTOS* 🤖\n\n📋 *COMANDOS:*\n\n💰 */qr [valor]* - Gerar PIX\n🎮 */jogo [valor]* - Gerar PIX\n📊 */dashboard* - Ver informações\n📝 */cadastro* - Criar conta\n💳 */email [chave]* - Cadastrar chave PIX\n💸 */saque [valor]* - Sacar saldo\n🗑️ */excluir* - Excluir conta\n🔍 */status saque [ID]* - Status do saque\n🧮 */calculadora [conta]* - Calcular\n🔍 */status [ID]* - Consultar pagamento\n📊 */status* - Status do bot\n❓ */ajuda* - Ajuda\n\n💰 *Taxa:* ${TAXA_BOT * 100}%\n💵 *Limite:* R$ 15.000,00\n📞 *Contato ADM:* ${ADM_CONTATO}`;
            await message.reply(ajuda);
            return;
        }
        
        if (comando.startsWith('/qr ') || comando.startsWith('/jogo ')) {
            let valor;
            if (comando.startsWith('/qr ')) valor = body.substring(4).trim();
            else valor = body.substring(6).trim();
            
            if (!valor) {
                await message.reply('❌ *Use:* `/qr 100` ou `/jogo 100`');
                return;
            }
            
            const contact = await message.getContact();
            const nomeWhatsApp = contact.pushname || contact.name || 'Cliente';
            await getOrCreateUser(senderId, nomeWhatsApp, '');
            const loadingMsg = await message.reply(`⏳ *┃ GERANDO PAGAMENTO...* ┃⏳\n\n💎 *Valor:* R$ ${valor}\n🔄 *Aguarde...*`);
            const chatId = chat.id._serialized;
            const pagamento = await gerarPix(valor, nomeWhatsApp, chatId, senderId);
            if (pagamento.sucesso) {
                await enviarMensagemComQRCode(message, pagamento);
            } else {
                await message.reply(`❌ *ERRO*\n\n${pagamento.erro}`);
            }
            setTimeout(async () => { try { await loadingMsg.delete(true); } catch(e) {} }, 2000);
        }
    } catch (error) {
        enviarLog('error', `Erro ao processar mensagem: ${error.message}`);
        await message.reply('❌ *ERRO AO PROCESSAR*\n\nTente novamente.');
    }
});

client.on('auth_failure', (msg) => {
    enviarLog('error', `Falha na autenticação: ${msg}`);
    console.error('❌ Falha na autenticação:', msg);
});

client.on('disconnected', (reason) => {
    enviarLog('warning', `Bot desconectado: ${reason}`);
    console.log('❌ Desconectado:', reason);
});

console.log('\n🚀 INICIANDO BOT 7CODE...\n');
console.log(`✅ Sistema otimizado para Railway`);
console.log(`🔄 Verificação automática ativa`);
console.log(`💰 Taxa do bot: ${TAXA_BOT * 100}%`);
console.log(`📞 Contato ADM: ${ADM_CONTATO}`);
console.log(`🌐 Painel web: ${PAINEL_URL}\n`);
client.initialize();
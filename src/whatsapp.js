const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const { PaymentService } = require('./payment.js');

class WhatsAppBot {
    constructor() {
        this.client = new Client({
            authStrategy: new LocalAuth(),
            puppeteer: {
                headless: true,
                args: [
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-dev-shm-usage'
                ]
            }
        });
        this.paymentService = new PaymentService();
        this.isReady = false;
        this.setupEventHandlers();
    }
    
    setupEventHandlers() {
        this.client.on('qr', (qr) => {
            console.log('📱 Escaneie o QR Code abaixo com seu WhatsApp:');
            qrcode.generate(qr, { small: true });
        });
        
        this.client.on('ready', () => {
            this.isReady = true;
            console.log('\n✅ Bot 7Code está online!');
            console.log('═══════════════════════════════');
            console.log('💡 Comandos:');
            console.log('   /qr 100 - Gera pagamento PIX');
            console.log('   /ajuda - Ajuda');
            console.log('   /status - Status do bot');
            console.log('═══════════════════════════════\n');
        });
        
        this.client.on('message', async (message) => {
            if (message.fromMe) return;
            await this.handleMessage(message);
        });
        
        this.client.on('auth_failure', (msg) => {
            console.error('❌ Falha na autenticação:', msg);
        });
        
        this.client.on('disconnected', (reason) => {
            this.isReady = false;
            console.log('❌ Bot desconectado:', reason);
        });
    }
    
    async handleMessage(message) {
        try {
            const body = message.body.trim();
            if (!body.startsWith('/')) return;
            
            console.log(`📨 Comando: ${body}`);
            
            const [command, ...args] = body.split(' ');
            const arg = args.join(' ');
            
            if (command === '/qr') {
                await this.handleQrCommand(message, arg);
            } else if (command === '/ajuda' || command === '/help') {
                await this.handleHelpCommand(message);
            } else if (command === '/status') {
                await this.handleStatusCommand(message);
            } else {
                await message.reply('❌ Comando inválido. Digite /ajuda');
            }
        } catch (error) {
            console.error('❌ Erro:', error);
        }
    }
    
    async handleQrCommand(message, amount) {
        if (!amount) {
            await message.reply('❌ *Use:* `/qr 100` ou `/qr 100,50`');
            return;
        }
        
        const loadingMsg = await message.reply('🔄 *Gerando pagamento PIX...*\nAguarde um momento.');
        
        try {
            const contact = await message.getContact();
            const customerName = contact.pushname || contact.name || 'Cliente';
            
            const payment = await this.paymentService.createPixPayment(amount, customerName);
            
            if (payment.success) {
                const pixMessage = `💰 *PAGAMENTO PIX - 7CODE* 💰\n\n` +
                                 `✅ *Valor:* R$ ${payment.amount.toFixed(2)}\n` +
                                 `🆔 *Transação:* ${payment.transactionId}\n` +
                                 `⏳ *Status:* Aguardando pagamento\n\n` +
                                 `📱 *Código PIX:*\n` +
                                 `${payment.pixQrCode}\n\n` +
                                 `🔗 *QR Code:* ${payment.qrCodeImage}\n\n` +
                                 `💡 Escaneie o código no app do seu banco`;
                
                await message.reply(pixMessage);
                console.log(`✅ Pagamento: R$ ${payment.amount.toFixed(2)}`);
            } else {
                await message.reply(payment.error);
            }
        } catch (error) {
            console.error('❌ Erro:', error);
            await message.reply('❌ Erro ao gerar pagamento. Tente novamente.');
        } finally {
            setTimeout(async () => {
                try {
                    await loadingMsg.delete(true);
                } catch (e) {}
            }, 3000);
        }
    }
    
    async handleHelpCommand(message) {
        const helpText = `🤖 *7CODE - BOT DE PAGAMENTOS* 🤖\n\n` +
                       `📋 *Comandos:*\n\n` +
                       `💵 */qr [valor]* - Gerar QR Code PIX\n` +
                       `   Ex: /qr 100 ou /qr 100,50\n\n` +
                       `❓ */ajuda* - Mostrar ajuda\n\n` +
                       `📊 */status* - Status do bot\n\n` +
                       `⚡ Pagamento instantâneo!`;
        
        await message.reply(helpText);
    }
    
    async handleStatusCommand(message) {
        const statusText = `🤖 *STATUS 7CODE*\n\n` +
                         `✅ Status: ${this.isReady ? 'Online 🟢' : 'Offline 🔴'}\n` +
                         `💰 Gateway: PodPay\n` +
                         `📅 Versão: 1.0.0\n\n` +
                         `✨ Bot pronto!`;
        
        await message.reply(statusText);
    }
    
    async initialize() {
        try {
            console.log('🚀 Iniciando Bot 7Code...\n');
            await this.client.initialize();
        } catch (error) {
            console.error('❌ Erro fatal:', error);
            process.exit(1);
        }
    }
}

module.exports = { WhatsAppBot };
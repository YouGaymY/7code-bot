const axios = require('axios');
const config = require('./config.js');

class PaymentService {
    async createPixPayment(amount, customerName) {
        try {
            // Converte valor (ex: "100,50" -> 10050 centavos)
            let valor = amount.toString().replace(',', '.');
            let valorNumerico = parseFloat(valor);
            let valorCentavos = Math.round(valorNumerico * 100);
            
            if (isNaN(valorCentavos) || valorCentavos <= 0) {
                return { error: 'Valor inválido' };
            }
            
            const payload = {
                paymentMethod: 'pix',
                postbackUrl: config.POSTBACK_URL,
                customer: {
                    document: { type: 'cpf', number: '12345678900' },
                    name: customerName || 'Cliente',
                    email: 'cliente@email.com',
                    phone: '11999999999'
                },
                amount: valorCentavos,
                items: [{ title: `Pagamento R$ ${valorNumerico}`, unitPrice: valorCentavos, quantity: 1, tangible: false }]
            };
            
            const response = await axios.post(config.PODPAY_API_URL, payload, {
                headers: { 'Content-Type': 'application/json', 'x-api-key': config.PODPAY_SECRET_KEY }
            });
            
            if (response.data && response.data.success) {
                return {
                    success: true,
                    amount: valorNumerico,
                    pixQrCode: response.data.data.pixQrCode,
                    qrCodeImage: response.data.data.pixQrCodeImage,
                    transactionId: response.data.data.id
                };
            }
            
            return { error: 'Erro ao gerar pagamento' };
        } catch (error) {
            console.error('Erro:', error.message);
            return { error: 'Erro na API' };
        }
    }
}

module.exports = { PaymentService };
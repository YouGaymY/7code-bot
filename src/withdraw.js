const axios = require('axios');

const PODPAY_WITHDRAW_URL = 'https://api.podpay.app/v1/withdrawals';
const PODPAY_SECRET_KEY = process.env.PODPAY_SECRET_KEY || '';

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
        console.error('Erro ao criar saque:', error.response?.data || error.message);
        return { sucesso: false, erro: error.response?.data?.message || 'Erro na conexão' };
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
                completedAt: response.data.data.completedAt
            };
        }
        return { sucesso: false };
    } catch (error) {
        console.error('Erro ao verificar saque:', error.message);
        return { sucesso: false };
    }
}

module.exports = { criarSaqueAPI, verificarStatusSaque };
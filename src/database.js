const sqlite3 = require('sqlite3');
const { open } = require('sqlite');
const path = require('path');
const fs = require('fs');

// Caminho persistente para Railway
const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'database.sqlite');
const DB_DIR = path.dirname(DB_PATH);

// Garantir que o diretório existe
if (!fs.existsSync(DB_DIR)) {
    fs.mkdirSync(DB_DIR, { recursive: true });
}

let db;

async function initializeDatabase() {
    db = await open({
        filename: DB_PATH,
        driver: sqlite3.Database
    });

    // Criar tabela de usuários
    await db.exec(`
        CREATE TABLE IF NOT EXISTS usuarios (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id TEXT UNIQUE NOT NULL,
            nome TEXT NOT NULL,
            numero_whatsapp TEXT,
            faturamento_mensal REAL DEFAULT 0,
            codigo TEXT UNIQUE NOT NULL,
            pix_key TEXT,
            pix_key_type TEXT,
            saldo_disponivel REAL DEFAULT 0,
            total_recebido REAL DEFAULT 0,
            total_sacado REAL DEFAULT 0,
            ticket_medio REAL DEFAULT 0,
            numero_transacoes INTEGER DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);

    // Criar tabela de transações PIX
    await db.exec(`
        CREATE TABLE IF NOT EXISTS transacoes_pix (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            transaction_id TEXT UNIQUE NOT NULL,
            user_id TEXT NOT NULL,
            valor_bruto REAL NOT NULL,
            valor_liquido REAL NOT NULL,
            taxa REAL NOT NULL,
            status TEXT DEFAULT 'pending',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES usuarios(user_id) ON DELETE CASCADE
        )
    `);

    // Criar tabela de saques
    await db.exec(`
        CREATE TABLE IF NOT EXISTS saques (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            withdrawal_id TEXT UNIQUE NOT NULL,
            user_id TEXT NOT NULL,
            valor REAL NOT NULL,
            pix_key TEXT NOT NULL,
            pix_key_type TEXT NOT NULL,
            status TEXT DEFAULT 'pending',
            fee REAL DEFAULT 0,
            net_amount REAL DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES usuarios(user_id) ON DELETE CASCADE
        )
    `);

    console.log('✅ Banco de dados inicializado em:', DB_PATH);
    return db;
}

function gerarCodigo() {
    const numero = Math.floor(Math.random() * 9000) + 1000;
    return `QR${numero}`;
}

async function getOrCreateUser(userId, nome, numeroWhatsapp) {
    const usuario = await db.get('SELECT * FROM usuarios WHERE user_id = ?', userId);
    
    if (!usuario) {
        const codigo = gerarCodigo();
        const numero = numeroWhatsapp || userId.replace(/@c\.us|@lid/g, '');
        
        await db.run(
            'INSERT INTO usuarios (user_id, nome, numero_whatsapp, codigo) VALUES (?, ?, ?, ?)',
            userId, nome, numero, codigo
        );
        return await db.get('SELECT * FROM usuarios WHERE user_id = ?', userId);
    }
    
    return usuario;
}

async function updateUser(userId, data) {
    const campos = [];
    const valores = [];
    
    for (const [key, value] of Object.entries(data)) {
        campos.push(`${key} = ?`);
        valores.push(value);
    }
    
    valores.push(userId);
    await db.run(`UPDATE usuarios SET ${campos.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?`, valores);
}

async function registrarTransacaoPix(transactionId, userId, valorBruto, taxa = 0.25) {
    const valorLiquido = valorBruto * (1 - taxa);
    
    await db.run(
        'INSERT INTO transacoes_pix (transaction_id, user_id, valor_bruto, valor_liquido, taxa) VALUES (?, ?, ?, ?, ?)',
        transactionId, userId, valorBruto, valorLiquido, taxa
    );
    
    const usuario = await db.get('SELECT * FROM usuarios WHERE user_id = ?', userId);
    const novoSaldo = (usuario.saldo_disponivel || 0) + valorLiquido;
    const totalRecebido = (usuario.total_recebido || 0) + valorBruto;
    const novaTransacoes = (usuario.numero_transacoes || 0) + 1;
    const novoTicketMedio = totalRecebido / novaTransacoes;
    
    await db.run(
        'UPDATE usuarios SET saldo_disponivel = ?, total_recebido = ?, numero_transacoes = ?, ticket_medio = ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?',
        novoSaldo, totalRecebido, novaTransacoes, novoTicketMedio, userId
    );
    
    return { valorLiquido, novoSaldo };
}

async function updateTransacaoPixStatus(transactionId, status) {
    await db.run(
        'UPDATE transacoes_pix SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE transaction_id = ?',
        status, transactionId
    );
}

async function registrarSaque(withdrawalId, userId, valor, pixKey, pixKeyType) {
    await db.run(
        'INSERT INTO saques (withdrawal_id, user_id, valor, pix_key, pix_key_type) VALUES (?, ?, ?, ?, ?)',
        withdrawalId, userId, valor, pixKey, pixKeyType
    );
    
    const usuario = await db.get('SELECT * FROM usuarios WHERE user_id = ?', userId);
    const novoSaldo = (usuario.saldo_disponivel || 0) - valor;
    const totalSacado = (usuario.total_sacado || 0) + valor;
    
    await db.run(
        'UPDATE usuarios SET saldo_disponivel = ?, total_sacado = ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?',
        novoSaldo, totalSacado, userId
    );
    
    return { novoSaldo, totalSacado };
}

async function updateSaqueStatus(withdrawalId, status, fee = 0, netAmount = 0) {
    await db.run(
        'UPDATE saques SET status = ?, fee = ?, net_amount = ?, updated_at = CURRENT_TIMESTAMP WHERE withdrawal_id = ?',
        status, fee, netAmount, withdrawalId
    );
}

async function savePixKey(userId, pixKey, pixKeyType) {
    await db.run(
        'UPDATE usuarios SET pix_key = ?, pix_key_type = ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?',
        pixKey, pixKeyType, userId
    );
}

async function getDashboard(userId) {
    return await db.get(`
        SELECT 
            nome,
            codigo,
            numero_whatsapp,
            saldo_disponivel,
            total_recebido,
            total_sacado,
            ticket_medio,
            numero_transacoes,
            faturamento_mensal,
            pix_key,
            pix_key_type,
            (SELECT COUNT(*) FROM transacoes_pix WHERE user_id = ? AND status = 'paid') as transacoes_confirmadas,
            (SELECT COUNT(*) FROM saques WHERE user_id = ? AND status IN ('completed', 'paid')) as saques_realizados
        FROM usuarios 
        WHERE user_id = ?
    `, [userId, userId, userId]);
}

async function deleteUser(userId) {
    try {
        const usuario = await db.get('SELECT * FROM usuarios WHERE user_id = ?', userId);
        if (!usuario) return false;
        if (usuario.saldo_disponivel > 0) return false;
        
        await db.run('DELETE FROM transacoes_pix WHERE user_id = ?', userId);
        await db.run('DELETE FROM saques WHERE user_id = ?', userId);
        const result = await db.run('DELETE FROM usuarios WHERE user_id = ?', userId);
        
        return result.changes > 0;
    } catch (error) {
        console.error('Erro ao deletar usuário:', error);
        return false;
    }
}

async function getAllUsers() {
    return await db.all(`
        SELECT user_id, nome, numero_whatsapp, codigo, saldo_disponivel, total_recebido, total_sacado, created_at
        FROM usuarios ORDER BY created_at DESC
    `);
}

async function getStats() {
    const totalUsuarios = await db.get('SELECT COUNT(*) as total FROM usuarios');
    const totalTransacoes = await db.get('SELECT COUNT(*) as total, SUM(valor_bruto) as soma FROM transacoes_pix WHERE status = "paid"');
    const totalSaques = await db.get('SELECT COUNT(*) as total, SUM(valor) as soma FROM saques WHERE status IN ("completed", "paid")');
    
    return {
        usuarios: totalUsuarios.total || 0,
        transacoes: { total: totalTransacoes.total || 0, valor_total: totalTransacoes.soma || 0 },
        saques: { total: totalSaques.total || 0, valor_total: totalSaques.soma || 0 }
    };
}

module.exports = {
    initializeDatabase,
    getOrCreateUser,
    updateUser,
    registrarTransacaoPix,
    updateTransacaoPixStatus,
    registrarSaque,
    updateSaqueStatus,
    savePixKey,
    getDashboard,
    deleteUser,
    getAllUsers,
    getStats,
    gerarCodigo,
    db
};
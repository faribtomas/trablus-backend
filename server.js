if (process.env.NODE_ENV !== 'production') {
  require('dotenv').config();
} // 1. Agregado para leer process.env
const express = require('express');
const mysql = require('mysql2');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

// 1. CONEXIÓN A MYSQL (ÚNICA Y DEFINITIVA - AHORA CON PROMESAS)
const db = mysql.createPool({
  host: process.env.MYSQL_HOST,
  port: process.env.MYSQL_PORT,
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  database: process.env.MYSQL_DATABASE,
  ssl: { rejectUnauthorized: false }
}).promise();
console.log("🔍 Intentando conectar con el enlace oficial de Aiven...");

// Verificación de conexión actualizada para promesas
(async () => {
    try {
        const connection = await db.getConnection();
        console.log('✅ Conectado a la base de datos MySQL de TRABLUSmodas en la Nube');
        connection.release(); // Devuelve la conexión
    } catch (err) {
        console.error('❌ Error de conexión a la BD:', err.message);
    }
})();

// 2. ENDPOINT PÚBLICO (COMPRAR)
app.post('/api/comprar', async (req, res) => {
    try {
        const { productId, size, cantidad } = req.body;
        const sql = `
            UPDATE product_variants 
            SET stock = stock - ?,
                status = CASE WHEN stock - ? = 0 THEN 'out_of_stock' ELSE status END
            WHERE product_id = ? AND size = ? AND stock >= ? AND status = 'available'
        `;
        const [result] = await db.query(sql, [cantidad, cantidad, productId, size, cantidad]);

        if (result.affectedRows > 0) {
            return res.status(200).json({ mensaje: 'Stock reservado exitosamente' });
        } else {
            return res.status(409).json({ error: true, mensaje: 'Sin stock suficiente' });
        }
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: true, mensaje: 'Error interno' });
    }
});

// ============================================================================
// 3. ENDPOINTS PRIVADOS (PANEL DE ADMINISTRADOR)
// ============================================================================

// RUTA SECRETA PARA CREAR LA TABLA EN LA NUBE
// ADVERTENCIA: Esta ruta creaba 'productos' plana, pero tus endpoints usan 'products' y 'product_variants'. 
// Lo ideal es que crees las tablas relacionales correctas desde tu cliente SQL (como DBeaver o Workbench). 
// He adaptado este endpoint para que devuelva un aviso en lugar de crear una tabla incorrecta.
app.get('/crear-tablas', async (req, res) => {
    res.send('⚠️ Aviso: Las tablas deben ser "products", "categories" y "product_variants". Por favor, créalas manualmente en tu gestor SQL con sus respectivas relaciones.');
});

// A. LEER el inventario 
app.get('/api/admin/productos', async (req, res) => {
    try {
        const sql = `
            SELECT p.id as product_id, p.name, p.price, p.image_url, c.name as category, 
                   v.id as variant_id, v.size, v.stock 
            FROM products p
            LEFT JOIN categories c ON p.category_id = c.id
            LEFT JOIN product_variants v ON p.id = v.product_id
            ORDER BY p.id DESC
        `;
        const [rows] = await db.query(sql);
        res.json(rows);
    } catch (error) {
        res.status(500).json({ error: true, mensaje: 'Error al cargar' });
    }
});

// B. CREAR nueva prenda 
app.post('/api/admin/productos', async (req, res) => {
    try {
        const { name, price, category_id, size, stock, imageUrl } = req.body;
        
        const finalImage = imageUrl || 'https://images.unsplash.com/photo-1441984904996-e0b6ba687e04?auto=format&fit=crop&q=80&w=800';

        let productId;
        const [existingProduct] = await db.query('SELECT id FROM products WHERE name = ?', [name]);
        
        if (existingProduct.length > 0) {
            productId = existingProduct[0].id;
        } else {
            const sqlProduct = 'INSERT INTO products (name, price, category_id, image_url) VALUES (?, ?, ?, ?)';
            const [productResult] = await db.query(sqlProduct, [name, price, category_id, finalImage]);
            productId = productResult.insertId;
        }

        const sqlVariant = `
            INSERT INTO product_variants (product_id, size, stock) 
            VALUES (?, ?, ?) 
            ON DUPLICATE KEY UPDATE stock = stock + ?
        `;
        await db.query(sqlVariant, [productId, size, stock, stock]);
        res.status(201).json({ mensaje: 'Prenda guardada exitosamente' });
    } catch (error) {
        res.status(500).json({ error: true, mensaje: 'Error al guardar' });
    }
});

// C. ACTUALIZAR (Editar stock o precio)
app.put('/api/admin/productos/:variantId', async (req, res) => {
    try {
        const { variantId } = req.params;
        const { price, stock } = req.body;

        await db.query('UPDATE product_variants SET stock = ? WHERE id = ?', [stock, variantId]);

        const [variantInfo] = await db.query('SELECT product_id FROM product_variants WHERE id = ?', [variantId]);
        if (variantInfo.length > 0) {
            await db.query('UPDATE products SET price = ? WHERE id = ?', [price, variantInfo[0].product_id]);
        }
        res.json({ mensaje: 'Producto actualizado con éxito' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: true, mensaje: 'Error al editar' });
    }
});

// D. BORRAR (Eliminar un talle/prenda)
app.delete('/api/admin/productos/:variantId', async (req, res) => {
    try {
        const { variantId } = req.params;
        await db.query('DELETE FROM product_variants WHERE id = ?', [variantId]);
        res.json({ mensaje: 'Prenda eliminada de la base de datos' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: true, mensaje: 'Error al eliminar' });
    }
});

// 4. INICIAR EL SERVIDOR
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Servidor Backend corriendo en http://localhost:${PORT}`);
});
const express = require('express');
const cors = require('cors');
const mysql = require('mysql2');

const app = express();
app.use(cors());
app.use(express.json());

// 1. CONEXIÓN A MYSQL (CON LLAVE MAESTRA)
const db = mysql.createPool({
    uri: process.env.DATABASE_URL, // Render le inyectará el enlace completo
    ssl: {
        rejectUnauthorized: false
    },
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

db.getConnection((err, connection) => {
    if (err) {
        console.error('❌ Error de conexión a la BD:', err.message);
    } else {
        console.log('✅ Conectado a la base de datos MySQL de TRABLUSmodas en la Nube');
        connection.release(); // Esto devuelve la conexión para que no se trabe
    }
});

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
app.get('/crear-tablas', (req, res) => {
    const sql = `CREATE TABLE IF NOT EXISTS productos (
        id INT AUTO_INCREMENT PRIMARY KEY,
        nombre VARCHAR(255) NOT NULL,
        precio DECIMAL(10,2) NOT NULL,
        stock INT NOT NULL,
        categoria VARCHAR(100),
        talle VARCHAR(50),
        imagen_url VARCHAR(500)
    )`;
    
    db.query(sql, (err, result) => {
        if (err) {
            console.error('Error al crear la tabla:', err);
            return res.send('Hubo un error al crear la tabla: ' + err.message);
        }
        res.send('🎉 ¡Éxito! La tabla de productos se creó perfectamente en Aiven.');
    });
});

// A. LEER el inventario (Ahora trae la imagen)
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

// B. CREAR nueva prenda (Ahora recibe la imagen)
app.post('/api/admin/productos', async (req, res) => {
    try {
        const { name, price, category_id, size, stock, imageUrl } = req.body;
        
        // Usamos una imagen genérica si el usuario deja el casillero vacío
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
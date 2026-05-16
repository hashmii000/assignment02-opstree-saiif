const express = require('express');
const router = express.Router();
const pool = require('../db');
router.get('/', async (req, res) => {
const result = await pool.query('SELECT * FROM users');
res.json(result.rows);
});
router.post('/', async (req, res) => {
const { name, email } = req.body;
const result = await pool.query(
'INSERT INTO users(name, email) VALUES($1, $2) RETURNING *',
[name, email]
);
res.json(result.rows[0]);
});
module.exports = router;

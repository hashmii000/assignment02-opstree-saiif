const express = require('express');
const userRoutes = require('./router/users');
const app = express();
app.use(express.json());
app.use('/users', userRoutes);
app.get('/health', (req, res) => {
res.json({ status: 'ok' });
});
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
console.log(`Server running on port ${PORT}`);
});


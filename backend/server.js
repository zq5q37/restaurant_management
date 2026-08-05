const app = require('./app');
const { migrate } = require('./db');

// Idempotent; ensures the schema exists on a fresh volume before any request is served.
migrate();

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on ${PORT}`));
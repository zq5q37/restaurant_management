const express = require('express');
const cors = require('cors');
const app = express();
const PORT = process.env.PORT || 5000;

// Enable CORS so the React app can access this API safely during dev
app.use(cors());
app.use(express.json());

// Sample placeholder API endpoint
app.get('/api/message', (req, res) => {
  res.json({ message: "Hello from the Express backend meow!" });
});

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});

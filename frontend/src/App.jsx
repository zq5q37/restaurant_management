import { useEffect, useState } from 'react';

function App() {
  const [data, setData] = useState('');

  useEffect(() => {
    fetch('/api/health')
      .then((res) => res.json())
      .then((data) => setData(data.message))
      .catch((err) => console.error("Error fetching data:", err));
  }, []);

  return (
    <div style={{ textAlign: 'center', marginTop: '50px' }}>
      <h1>React Frontend</h1>
      <p>{data ? data : "Loading backend message..."}</p>
    </div>
  );
}

export default App;

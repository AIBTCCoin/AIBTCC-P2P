import mysql from 'mysql2/promise';

// Fetch the database name from environment variables or default to 'blockchain'
const databaseName = process.env.DATABASE_NAME || 'blockchain';

const db = mysql.createPool({
  host: 'localhost', 
  port: 3306,        
  user: 'root',
  password: 'g46',
  database: databaseName, // Dynamic database name
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

db.getConnection()
  .then(connection => {
    console.log(`Connected to database: ${databaseName}`);;
    connection.release();
  })
  .catch(err => {
    console.error('Database connection failed:', err);
    process.exit(1); // Exit the process if the database connection fails
  });

export {db};



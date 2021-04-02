const Database = require('better-sqlite3');
const db = new Database('./persondb.db', { verbose: console.log });

// const row = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
// console.log(row.firstName, row.lastName, row.email);

// const stmt = db.prepare('SELECT * FROM PERSON WHERE PRSN_LAST_NAME = ?');
// const foundPerson = stmt.get('Lennon');

// console.log(foundPerson.PRSN_ID); 

const stmt = db.prepare(`select * from PERSON WHERE PRSN_ID = 1`)
        
const foundPerson = stmt.get();
console.log(foundPerson)


// const row = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);

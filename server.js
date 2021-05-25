const express = require('express');
const connectDB = require('./config/db');
const app = express();

connectDB();

app.get('/',(req,res)=>res.send('API Running'));
app.use(express.json({extended:false}));

app.use('/api/users', require('./routes/api/users'));
app.use('/api/auth', require('./routes/api/auth'));
app.use('/api/profile', require('./routes/api/profile'));
app.use('/api/plans', require('./routes/api/plans'));
app.use('/api/predict', require('./routes/api/predict')); //temporarily i've put this route okay i may later put it under profile/predict_hobby

const PORT = process.env.PORT || 5000;

app.listen(PORT, ()=>(console.log(`Server started on port ${PORT}`)));
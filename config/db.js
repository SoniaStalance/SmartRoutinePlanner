const mongoose = require('mongoose');
const config = require('config')
const db = config.get('mongoURI');

const connectDB = async() => {
    try{
        mongoose.set('useCreateIndex', true);
        await mongoose.connect(db,{useNewUrlParser: true, useUnifiedTopology: true,  useFindAndModify: false});
        console.log("Database connected")
    }catch(err)
    {
        console.log(err);
        process.exit(1);
    }
};

module.exports = connectDB;

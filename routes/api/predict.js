const express = require('express');
const router = express.Router();
const auth = require('../../middleware/auth'); //not req now
const Profile = require('../../models/Profile');
const User = require('../../models/User'); //not req now
const tf = require('@tensorflow/tfjs');
const dataset = require('../../data/userdata');

/*
GET api/profile/train_hobbies_model
pass integer values
*/
router.post('/train_hobbies_model', async (req,res)=>{
    try{        
            const {
                age,
                status
            } = req.body;

            const allprofiles = await Profile.find();
            p = Object.entries(allprofiles)

            const hobbyList =  ['baking', 'writing','singing', 'cricket', 'coding', 'dancing', 'tennis', 'painting', 'sewing','reading','knitting', 'movies', 'gaming','cooking','football','travel','photographgy', 'listening_music', 'playing_musical_instruments','gardening','blogging','indoor_games','social_service','shopping'];
            const statusList = ['unmarried', 'married', 'divorced', 'widowed'];
            var allhobbies = [];

            p.forEach(([key, value]) => {
                if((value.hobbies).length>0)
                {
                    (value.hobbies).forEach(hob => {
                        allhobbies.push({age: parseInt(value.age), status: statusList.indexOf(value.status), hobby: hobbyList.indexOf(hob)});
                    })
                }
            });
            
            var inputs = []
            var outputs = []

            inputs = allhobbies.map(d => [d.age, d.status])
            outputs = allhobbies.map(d => d.hobby);

            
            for(let cat = 0; cat < dataset.length; cat++) {
                for(let ent = 0; ent < dataset[cat].length; ent++) {
                    inputs.push([dataset[cat][ent][0], dataset[cat][ent][1]])
                    outputs.push(dataset[cat][ent][2])
                }
            }
            
            const inputTensor = tf.tensor2d(inputs, [inputs.length, inputs[0].length]);
            const outputTensor = tf.oneHot(tf.tensor1d(outputs, 'int32'), hobbyList.length);
            

            const model = tf.sequential(); 
            
            model.add(tf.layers.dense({inputShape: [2], units: parseInt(hobbyList.length * 2), useBias: true, activation: 'mish'}));
            model.add(tf.layers.dense({units: parseInt(hobbyList.length * 2), useBias: true, activation: 'mish'}));
            model.add(tf.layers.dense({units: parseInt(hobbyList.length * 1.5), useBias: true, activation: 'mish'}));
            model.add(tf.layers.dense({units: parseInt(hobbyList.length * 1.5), useBias: true, activation: 'softplus'}));
            model.add(tf.layers.dense({units: hobbyList.length, useBias: true, activation: 'softmax'}));
            
            model.compile({loss: "categoricalCrossentropy", metrics: ['accuracy'], optimizer: tf.train.adam(0.01)});
            
            var acc;
            
            
            await model.fit(inputTensor, outputTensor, {
                batchSize: 50,
                epochs: 800,
                callbacks:{
                    onEpochEnd: async(epoch, logs) =>{
                        acc = logs.acc
                        if(acc >= 0.5){
                            model.stopTraining = true
                        }
                        console.log("Epoch: " + epoch + " Loss: " + logs.loss + " Accuracy: " + logs.acc);
                    }
                }
              });
        
            acc = acc * 100  
            console.log('Accuracy='+ (acc)+'%')
            
            const testVal = tf.tensor2d([age, status], [1, 2]);

            const prediction = model.predict(testVal);
            
            const ix1 = tf.argMax(prediction, axis=1).dataSync();

            suggestedHobby = hobbyList[ix1];
            console.log('Age : ' + age + ' Status : ' + statusList[status] + ' Hobby suggested : ' + suggestedHobby + ' with '+acc+'% accuracy');
            
            return res.status(400).json({age: age, status: statusList[status], suggested: suggestedHobby, accuracy: acc});
    
        }catch(err){
        
        console.log(err.msg);
        res.status(500).send('Server error!');
    }
});

module.exports = router;
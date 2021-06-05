const express = require('express');
const router = express.Router();
const auth = require('../../middleware/auth');
const Profile = require('../../models/Profile');
const tf = require('@tensorflow/tfjs');

const dataset = require('../../data/userdata');
const { distinct } = require('../../models/Profile');

//common members for create/update plans
const categories = ['sleep', 'fitness', 'refreshment', 'work', 'chores', 'social', 'leisure', 'hobby', 'others', 'idle'];
//                      0       1           2             3         4        5          6         7         8       9
const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']

const countOccurrences = (arr, val) => arr.reduce((a, v) => (v === val ? a + 1 : a), 0); //func to find freq of values in an array

//finds the count of idle and essential categories
function idleANDessentials(myRoutine){
    var c_ref = 0;
    var c_slp = 0;
    var c_hls = 0;
    var c_idl = 0;
    myRoutine.forEach(r => {
        if(r.category == 'idle')
            c_idl ++
        if(r.category == 'refreshment')
            c_ref ++
        if(r.category == 'sleep')
        {
            //in minutes
            c_slp += ((((r.endTimeH * 12) + (r.endTimeM / 5)) - ((r.startTimeH * 12) + (r.startTimeM / 5))) * 5)
        }
        if(r.category == 'hobby' || r.category == 'leisure' || r.category == 'social')
            c_hls ++
    });
    return {c_idl: c_idl, c_ref: c_ref, c_slp: c_slp, c_hls: c_hls}
}

function validatePredictedPlan(category, task){
    var myRoutine = [];
    for(let t = 0; t < 288; t++){
        
        var cat = categories[category[t]]
        var tsk = task[t]
        var index = t;
        while((tsk == task[index]) && (cat == categories[category[index]])){
            index = index + 1;
    
            if((tsk == task[index]) && (cat == categories[category[index]])){
                continue;
            }
        }

        var start = t;
        var end = index;
        var startTimeH = parseInt(start/12);
        var startTimeM = (start - (startTimeH * 12)) * 5;
        var endTimeH = parseInt(end/12);
        var endTimeM = (end - (endTimeH * 12)) * 5;
        
        myRoutine.push({startTimeH: startTimeH, startTimeM: startTimeM, endTimeH: endTimeH, endTimeM: endTimeM , category: cat, task: tsk, priority: "low", done: false});
        t = index - 1; //cuz it gets incremented by 1
    }

    var counts = idleANDessentials(myRoutine)
    var c_idl = counts.c_idl
    var c_ref = counts.c_ref
    var c_slp = counts.c_slp
    var c_hls = counts.c_hls

    var direction = 0; //0 represents try including from begining & -1 represents try including from end
    //if sleep < 4 hrs
    while((c_slp < 240) && (c_idl != 0)){
        //here direction is always from top i.e. 0
        
        myRoutine = tryIncluding(myRoutine, 'sleep', direction)
        counts = idleANDessentials(myRoutine)
        c_idl = counts.c_idl
        c_slp = counts.c_slp
    }

    while((c_ref < 3) && (c_idl != 0)){
        
        myRoutine = tryIncluding(myRoutine, 'refreshment', direction)
        counts = idleANDessentials(myRoutine)
        c_idl = counts.c_idl
        c_ref = counts.c_ref
        //toggle direction
        direction = (direction == 0)? -1 : 0
    }

    while((c_hls < 1) && (c_idl != 0)){
        direction = -1
        
        myRoutine = tryIncluding(myRoutine, 'hobby', direction)
        counts = idleANDessentials(myRoutine)
        c_idl = counts.c_idl
        c_hls = counts.c_hls
    }
    
    return myRoutine;
}

function tryIncluding(myRoutine, cat, direction){
    var replaced = false
    switch(direction){
        case 0:{
            var i = 0;
            while(replaced == false && i < myRoutine.length){
                if(myRoutine[i].category == 'idle')
                {
                    myRoutine[i].category = cat;
                    myRoutine[i].task = cat;
                    replaced = true;
                }
                i++
            }
        }
        case -1:{
            var i = myRoutine.length -1;
            while(replaced == false && i >= 0){
                if(myRoutine[i].category == 'idle')
                {
                    console.log(cat+' included from down')
                    myRoutine[i].category = cat;
                    myRoutine[i].task = cat;
                    replaced = true;
                }
                i--
            }
        }
    }
    return myRoutine;
}

//func to prepare skeleton of plans
function prepare(myRoutine){
    var categorySlots = new Array(288).fill(-1);
    var taskSlots = new Array(288).fill('');
    myRoutine.forEach(p =>{
        var start = ((parseInt(p.startTimeH) * 12) + (parseInt(p.startTimeM) / 5));
        var end   = ((parseInt(p.endTimeH) * 12) + (parseInt(p.endTimeM) / 5));
        var task = (((p.task).replace(/[^a-zA-Z0-9]/g, '')).trim()).toLowerCase();

            for (let i = start; i < end; i++){
                
                categorySlots[i] = categories.indexOf(p.category);
                taskSlots[i] = task;
            }
        
    })
    
    return {categorySlots: categorySlots, taskSlots: taskSlots}
}
//common members for create/update plans ends here------------

/*
GET api/predict/plans
pass user token in headers
*/
router.get('/plans', auth, async(req, res)=>{
    try {
        const userPlanner = await Plan.findOne({user: req.user.id});

        if(!userPlanner){
            
            return res.status(400).json({msg: 'There is no planner for this user. Kindly create one.'});
        }
        else if((userPlanner.routine).length < 6){
            return res.status(400).json({msg: 'Less than 6 days plan is not sufficient for prediction!'});
        }
        else{
            var size = 0;
            var well_scored_days = 0;
            var well_rated_plans = 0;
            var plans_count = (userPlanner.routine).length;

            userPlanner.routine.forEach(d=>{
                if(parseInt(d.score)>=50)
                {
                    well_scored_days ++;
                }
                if(parseInt(d.feedback)>=3)
                {
                    well_rated_plans ++;
                }
                if(parseInt(d.score)>=50 && parseInt(d.feedback)>=3){
                    size ++;
                }
            })
            

            if(size < 6){
                if(well_scored_days < 6 && well_rated_plans >= 6)
                    return res.status(400).json({msg: 'You have 50% or more progress in only '+ well_scored_days + '/'+ plans_count +' days (MINIMUM = 6)'});
                else if(well_scored_days >= 6 && well_rated_plans < 6)
                    return res.status(400).json({msg: 'You have only '+ well_rated_plans + '/'+ plans_count +' well rated plans (MINIMUM = 6)'});
                else
                    return res.status(400).json({msg: 'You have 50% or more progress in only '+ well_scored_days + '/'+ plans_count +' days and only '+ well_rated_plans + '/'+ plans_count +' well rated plans (MINIMUM = 6)'});
            }
            else
            {
                var reqAcc = 0.7800
                if(req.body.reqAcc){
                    if(req.body.reqAcc == 'high'){
                        reqAcc = 0.8555
                    }
                }
                console.log(reqAcc)
                //group tasks under their respective categories (here cat no is index)
                var tasksInACategory = new Array(categories.length)
                for(let i = 0; i < tasksInACategory.length; i++)
                {
                    tasksInACategory[i] = []
                }
                //let d alias for each day's routine
                //for model1
                var features1 = [];
                var target1 = [];
                //for model2
                var features2 = [];
                var target2 = [];
                //today
                var date = new Date();
                var today = date.getDate();
                userPlanner.routine.forEach(d=>{
                    if(parseInt(d.score)>=50 && parseInt(d.feedback)>=3)
                    {
                        var skeleton = prepare(d.plan);
                        var categorySlots = skeleton.categorySlots;
                        var taskSlots = skeleton.taskSlots;

                        //if less than 2 weeks data is there then all plans are considered irrespective of their day
                        var day = (size < 14) ? (today) : ((d.date).getDay())
                        
                        for(let t = 0; t < 288; t++){
                            
                               //for model1
                                features1.push([day, t]);
                                target1.push(categorySlots[t]);
                                //for model2
                                features2.push([day, t, categorySlots[t]])
                                target2.push(taskSlots[t]);

                                if(!(tasksInACategory[categorySlots[t]]).includes(taskSlots[t]))
                                    tasksInACategory[categorySlots[t]].push(taskSlots[t])
                            
                        }
                    }
                })
                
                //bulid model to predict category given day, time
                const inputTensor = tf.tensor2d(features1, [features1.length, features1[0].length]);
                const targetTensor = tf.oneHot(tf.tensor1d(target1, 'int32'), categories.length);
                
                const model = tf.sequential(); 
                
                model.add(tf.layers.dense({inputShape: [2], units: parseInt(categories.length * 2), useBias: true, activation: 'mish'}));
                model.add(tf.layers.dense({units: parseInt(categories.length * 2), useBias: true, activation: 'mish'}));
                model.add(tf.layers.dense({units: parseInt(categories.length * 1.5), useBias: true, activation: 'mish'}));
                model.add(tf.layers.dense({units: parseInt(categories.length * 1.5), useBias: true, activation: 'softplus'}));
                model.add(tf.layers.dense({units: categories.length, useBias: true, activation: 'softmax'}));
                
                model.compile({loss: "categoricalCrossentropy", metrics: ['accuracy'], optimizer: tf.train.adam(0.01)});
                
                var buildCount = 0;
                var acc; 
                do{
                var prev = 0; 
                var c = 1;
                
                await model.fit(inputTensor, targetTensor, {
                    batchSize: 10,
                    epochs: 350,
                    callbacks:{
                        onEpochEnd: async(epoch, logs) =>{
                            acc = logs.acc
                            c = (parseInt(acc * 100) == prev) ? c+1 : 1
                            prev = parseInt(acc*100)
                            var loss = (logs.loss).toFixed(2)
                            if(loss <= 0.45 || acc >= reqAcc || c >= 10){
                                model.stopTraining = true
                            }
                            console.log("Epoch: " + epoch + " Loss: " + loss + " Accuracy: " + (logs.acc*100).toFixed(2) +' c='+c);
                        }
                    }
                    });
                    
                buildCount++;
                acc = acc * 100 
                //suppose they asked for high accuracy but high accuracy is unattainable then we reduce it a little 
                //loop will repeat (i.e model will be rebuilt incase accuracy < 70%)
                if(acc < reqAcc*100)
                    reqAcc = reqAcc - 0.05

                console.log('Build:'+buildCount)
                console.log('Condition:'+((parseInt(acc) < 65) && (buildCount < 2)))
                console.log('------------------------------------------------------')
                }while((acc < 65) && buildCount < 2 )
                
                console.log('Accuracy='+ (acc)+'%')
                
                var category = []; //output of model1
                for(let t=0; t<288; t++){    
                    const testVal = tf.tensor2d([today, t], [1, 2]);
                    const prediction = model.predict(testVal);            
                    const categoryPredicted = tf.argMax(prediction, axis=1).dataSync();
                    category.push(categoryPredicted);
                }

                //part2 bulid model to predict tasks given day, time, category
                const distinctTasks = [...new Set(target2)]
                const numeric_target2 = []; //target2 is in string form therefore convert it into numeric form
                target2.forEach(val => {
                    numeric_target2.push(distinctTasks.indexOf(val))
                })
                const inputTensor2 = tf.tensor2d(features2, [features2.length, features2[0].length]);
                const targetTensor2 = tf.oneHot(tf.tensor1d(numeric_target2, 'int32'), distinctTasks.length);
                
                
                const model2 = tf.sequential(); 

                model2.add(tf.layers.dense({inputShape: [3], units: parseInt(distinctTasks.length * 2), useBias: true, activation: 'mish'}));
                model.add(tf.layers.dense({units: parseInt(distinctTasks.length * 2), useBias: true, activation: 'mish'}));
                model.add(tf.layers.dense({units: parseInt(distinctTasks.length * 1.5), useBias: true, activation: 'mish'}));
                model2.add(tf.layers.dense({units: parseInt(distinctTasks.length * 1.5), useBias: true, activation: 'softplus'}));
                model2.add(tf.layers.dense({units: distinctTasks.length, useBias: true, activation: 'softmax'}));

                model2.compile({loss: "categoricalCrossentropy", metrics: ['accuracy'], optimizer: tf.train.adam(0.01)});
                var buildCount2 = 0;
                var acc2;
                var reqAcc2 = 0.93
                do{
                    var prev2 = 0; 
                    var c2 = 1;
                    await model2.fit(inputTensor2, targetTensor2, {
                        batchSize: 5,
                        epochs: 50,
                        callbacks:{
                            onEpochEnd: async(epoch, logs) =>{
                                acc2 = logs.acc
                                c2 = (parseInt(acc2 * 100) == prev2) ? c2+1 : 1
                                prev2 = parseInt(acc2*100)
                                var loss = (logs.loss).toFixed(2)
                                if(loss <= 0.10||acc2 >= reqAcc2||c2 >= 8){
                                    model2.stopTraining = true
                                }
                                console.log("Epoch: " + epoch + " Loss: " + loss + " Accuracy: " + (acc2*100).toFixed(2) +' c='+c2);
                            }
                        }
                    });
                    
                    buildCount2 ++
                    acc2 = acc2 * 100  
                    //if the req acc2 cannot be attained then we lower it a little
                    if(acc2 < reqAcc2*100)
                        reqAcc2 = reqAcc2 - 0.03
                    //loop will repeat (i.e model will be rebuilt incase accuracy < 80%)
                    console.log('Build:'+buildCount2)
                    console.log('Condition:'+((parseInt(acc2) < 75) && (buildCount2 < 3)))
                    console.log('------------------------------------------------------')
                }while((parseInt(acc2) < 75) && (buildCount2 < 3));
                

                console.log('Accuracy='+ (acc2)+'%')
                

                var task = [];
                //predict task for each timeslot (i.e. 0 to 287) given day, time, category
                for(let t=0; t < 288; t++){    
                    const testVal = tf.tensor2d([today, t, category[t]], [1, 3]);
                    var taskPredicted = '';
                    var count = 0;
                    do{
                        const prediction = model2.predict(testVal);        
                        taskPredicted = distinctTasks[tf.argMax(prediction, axis=1).dataSync()];
                        count++;
                    }while(((tasksInACategory[category[t]]).includes(taskPredicted)) == false  && count < 100)

                    if(count == 100){
                        taskPredicted = categories[category[t]]; //default if nothing can be predicted for time slot t
                    }
                    
                    task.push(taskPredicted);
                }
                console.log('came out')
                console.log('features1: '+features1.length)
                console.log('target1 :'+target1.length)
                console.log('features2: '+features2.length)
                console.log('numeric_target2 :'+numeric_target2.length)
                var dataset1 = [];
                var dataset2 = [];
                for(let i=0; i < features1.length; i++){
                    dataset1.push([days[features1[i][0]],(parseInt(features1[i][1]/12)+':'+((features1[i][1]-(parseInt(features1[i][1]/12)*12))*5)).toString(),categories[target1[i]]])
                    dataset2.push([days[features2[i][0]],(parseInt(features2[i][1]/12)+':'+((features2[i][1]-(parseInt(features2[i][1]/12)*12))*5)).toString(),categories[features2[i][2]],target2[i]])
                }

                var validPlan = validatePredictedPlan(category, task)

                return res.json({plan: validPlan, accuracy: acc})
            }
        }
    } catch (err) {
        console.log(err.msg);
        res.status(500).send('Server error!');
    }
})

/*
POST api/predict/hobbies
*/
router.get('/hobbies', auth, async (req,res)=>{
    try{
            const hobbyList =  ['baking', 'writing','singing', 'cricket', 'coding', 'dancing', 'tennis', 'painting', 'sewing','reading','knitting', 'movies', 'gaming','cooking','football','travel','photographgy', 'listening_music', 'playing_musical_instruments','gardening','blogging','indoor_games','social_service','shopping'];
            const statusList = ['unmarried', 'married', 'divorced', 'widowed'];

            const myProfile = await Profile.findOne({user: req.user.id});
            if(!myProfile){
                return res.status(400).json({msg: 'There is no profile for this user. Kindly create one.'});
            }
            var age = parseInt(myProfile.age)
            var status = statusList.indexOf(myProfile.status)

            const allprofiles = await Profile.find();
            p = Object.entries(allprofiles)

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
            const targetTensor = tf.oneHot(tf.tensor1d(outputs, 'int32'), hobbyList.length);
            

            const model = tf.sequential(); 
            
            model.add(tf.layers.dense({inputShape: [2], units: parseInt(hobbyList.length * 2), useBias: true, activation: 'mish'}));
            model.add(tf.layers.dense({units: parseInt(hobbyList.length * 2), useBias: true, activation: 'mish'}));
            model.add(tf.layers.dense({units: parseInt(hobbyList.length * 1.5), useBias: true, activation: 'mish'}));
            model.add(tf.layers.dense({units: parseInt(hobbyList.length * 1.5), useBias: true, activation: 'softplus'}));
            model.add(tf.layers.dense({units: hobbyList.length, useBias: true, activation: 'softmax'}));
            
            model.compile({loss: "categoricalCrossentropy", metrics: ['accuracy'], optimizer: tf.train.adam(0.01)});
            
            var acc;
            var prev = 0;
            var c = 1;
            
            await model.fit(inputTensor, targetTensor, {
                batchSize: 10,
                epochs: 350,
                callbacks:{
                    onEpochEnd: async(epoch, logs) =>{
                        acc = logs.acc
                        c = (parseInt(acc * 100) == prev) ? c+1 : 1
                        prev = parseInt(acc*100)
                        
                        if(acc >= 0.5 || c >= 12){
                            model.stopTraining = true
                        }
                        console.log("Epoch: " + epoch + " Loss: " + (logs.loss).toFixed(2) + " Accuracy: " + (logs.acc*100).toFixed(2) +' c='+c);
                    }
                }
              });
        
            acc = acc * 100  
            console.log('Accuracy='+ (acc)+'%')
            
            const testVal = tf.tensor2d([age, status], [1, 2]);

            const prediction = model.predict(testVal);            
            
            const values = prediction.dataSync();
            const arr = Array.from(values);
            const arrHobbies = hobbyList;
            
            //bubble sort to find the top three hobbies probablity
            for(var i = 0; i < arr.length; i++){
                for(var j = 0; j < ( arr.length - i -1 ); j++){
                  if(arr[j] < arr[j+1]){
                    var temp = arr[j]
                    var temp2 = arrHobbies[j]

                    arr[j] = arr[j + 1]
                    arrHobbies[j] = arrHobbies[j + 1]

                    arr[j+1] = temp
                    arrHobbies[j+1] = temp2
                    }
                }
            }
            
            var suggested = [arrHobbies[0], arrHobbies[1], arrHobbies[2]]
            
            console.log('Age : ' + age + ' Status : ' + statusList[status] + ' Hobbies suggested : ' + suggested + ' with '+acc+'% accuracy');
            
            return res.json({age: age, status: statusList[status], suggested: suggested, accuracy: acc});
    
        }catch(err){
        
        console.log(err.msg);
        res.status(500).send('Server error!');
    }
});

module.exports = router;
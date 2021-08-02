const express = require('express');
const router = express.Router();
const auth = require('../../middleware/auth');
const Profile = require('../../models/Profile');
const tf = require('@tensorflow/tfjs');
const dataset = require('../../data/userdata');
const cities = require('../../data/cities');
const { distinct } = require('../../models/Profile')

//common members for create/update plans
//array, catNo as input
const countOccurrences = (arr, val) => arr.reduce((a, v) => (v === val ? a + 1 : a), 0); //func to find freq of values in an array

const categories = ['sleep', 'fitness', 'refreshment', 'work', 'chores', 'social', 'leisure', 'hobby', 'others', 'idle'];
//                      0       1           2             3         4        5          6         7         8       9
const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']

function validatePredictedPlan(category, task){
    
    //sleep
    var sleep = countOccurrences(category, categories.indexOf('sleep'))
    
    //here, 48 slots = 240 mins = 4 hrs
    var t = 0
    while(sleep < 48 && t < 288){
        var count = 0
        var start = -1  //invalid
        var end = -1    //invalid

        if(category[t] == categories.indexOf('idle')){
            start = t
            end = t
            while(category[t] == categories.indexOf('idle')){
                end++
                count++
            }
        }

        if(count >= 6){
            //here, 6 slots = 30 min
            for(let slot = start; slot < end; slot++){
                if(sleep < 48){
                    category[slot] = categories.indexOf('sleep')
                    task[slot] = 'sleep'
                    sleep++
                }
            }
            t = end
        }
        else{
            t++
        }
    }

    //refreshment
    var morning = countOccurrences(category.slice(0,144), categories.indexOf('refreshment'))
    t=0
    while(morning==0 && t<144){
        if(category[t]==categories.indexOf('idle')){
            category[t] = categories.indexOf('refreshment')
            task[t] = 'breakfast'
            morning++
            if(category[t+1]==categories.indexOf('idle')){
                category[t+1] = categories.indexOf('refreshment')
                task[t+1] = 'breakfast'
                morning++
            }
        }
        t++
    }

    var noon = countOccurrences(category.slice(132, 216), categories.indexOf('refreshment'))
    t=132
    while(noon==0 && t<216){
        if(category[t]==categories.indexOf('idle')){
            category[t] = categories.indexOf('refreshment')
            task[t] = 'lunch'
            noon++
            if(category[t+1]==categories.indexOf('idle')){
                category[t+1] = categories.indexOf('refreshment')
                task[t+1] = 'lunch'
                noon++
            }
        }
        t++
    }

    var evening = countOccurrences(category.slice(204), categories.indexOf('refreshment'))
    t=204
    while(evening==0 && t<288){
        if(category[t]==categories.indexOf('idle')){
            category[t] = categories.indexOf('refreshment')
            task[t] = 'dinner'
            evening++
            if(category[t+1]==categories.indexOf('idle')){
                category[t+1] = categories.indexOf('refreshment')
                task[t+1] = 'dinner'
                evening++
            }
        }
        t++
    }
    
    //hobby,leisure,social
    var HLS = countOccurrences(category, categories.indexOf('hobby')) + countOccurrences(category, categories.indexOf('leisure')) + countOccurrences(category, categories.indexOf('social'))
    t=0
    while(HLS<4 && t<288){
        var start = -1
        var end = -1
        var count = 0
        if(category[t]==categories.indexOf('idle')){
            start = t
            end = t
            while(category[t]==categories.indexOf('idle')){
                count++
                end++
            }

            if(count >= 4){
                for(let slot=start; slot<end; slot++){
                    category[slot]=categories.indexOf('leisure')
                    task[slot] = 'leisure'
                    HLS++
                }
            }   
        }
        t++
    }
    return {category: category, task: task}
}

function structureValidatedPlan(category, task){
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
    return myRoutine
}

//func to prepare skeleton of plans(i.e. get category & task slots for every 5 min slot)
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
                if(req.query.reqAcc){
                    if(req.query.reqAcc == 'high'){
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
                var today = date.getDay();
                console.log(today)
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
                
                //printing the dataset for reference purpose
                for(let i = 0 ; i < features2.length; i++){
                    console.log(days[features2[i][0]]+"\t"+features2[i][1]+"\t"+categories[features2[i][2]]+"\t"+target2[i] )
                }
                
                //build model to predict category given day, time
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
                    epochs: 200,
                    callbacks:{
                        onEpochEnd: async(epoch, logs) =>{
                            acc = logs.acc
                            c = (parseInt(acc * 100) == prev) ? c+1 : 1
                            prev = parseInt(acc*100)
                            var loss = (logs.loss).toFixed(2)
                            console.log("Epoch: " + epoch + " Loss: " + loss + " Accuracy: " + (logs.acc*100).toFixed(2) +' c='+c);

                            if(loss <= 0.45 || acc >= reqAcc || c >= 10){
                                model.stopTraining = true
                            }
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
                console.log('Condition:'+((parseInt(acc) < reqAcc*100-15) && (buildCount < 2)))
                console.log('------------------------------------------------------')
                }while((acc < reqAcc*100-15) && buildCount < 2 )
                
                console.log('Accuracy='+ (acc)+'%')
                
                var category = []; //output of model1
                for(let t=0; t<288; t++){    
                    const testVal = tf.tensor2d([today, t], [1, 2]);
                    const prediction = model.predict(testVal);            
                    const categoryPredicted = tf.argMax(prediction, axis=1).dataSync();
                    category.push(categoryPredicted[0]);
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
                                console.log("Epoch: " + epoch + " Loss: " + loss + " Accuracy: " + (acc2*100).toFixed(2) +' c='+c2);

                                if(loss <= 0.10||acc2 >= reqAcc2||c2 >= 8){
                                    model2.stopTraining = true
                                }
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
                    console.log('Condition:'+((parseInt(acc2) < reqAcc2*100-25) && (buildCount2 < 2)))
                    console.log('------------------------------------------------------')
                }while((parseInt(acc2) < reqAcc2*100-25) && (buildCount2 < 2));
                

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
                    }while(((tasksInACategory[category[t]]).includes(taskPredicted)) == false  && count < 20)

                    if(count == 20){
                        taskPredicted = categories[category[t]]; //default if nothing can be predicted for time slot t
                    }
                    
                    task.push(taskPredicted);
                }

                var validatedPlan = validatePredictedPlan(category, task)
                category = validatedPlan.category
                task = validatedPlan.task

                var validPlan = structureValidatedPlan(category, task)
                
                return res.json({ plan: validPlan, accuracy: (acc*0.9)+(acc2*0.1)})
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
            const statusList = ['unmarried', 'married', 'divorced', 'widowed'];
            const occupationList = ['student', 'home-maker', 'working professional', 'retired', 'others'] //will use this later if needed :(

            const hobbyList =  ['pet keeping', 'martial arts','singing/music', 'outdoor games', 'programing', 'performing arts', 'board games', 'creative arts', 'collecting','reading/writing','sewing/knitting/embroidery', 'watching movies', 'gaming','culinary','sports','travelling','photography', 'DIY', 'foreign languages','gardening','blogging','indoor games','volunteering','shopping'];
            

            const myProfile = await Profile.findOne({user: req.user.id});
            if(!myProfile){
                return res.status(400).json({msg: 'There is no profile for this user. Kindly create one.'});
            }
            var age = parseInt(myProfile.age)
            var status = statusList.indexOf(myProfile.status)
            var myHobbies = myProfile.hobbies
            var occupation = occupationList.indexOf(myProfile.occupation)
            
            const allprofiles = await Profile.find();
            p = Object.entries(allprofiles)

            var allhobbies = [];

            p.forEach(([key, value]) => {
                var a = parseInt(value.age)
                if((value.hobbies).length>0 && (a >= age-5 && a<= age+5))
                {
                    (value.hobbies).forEach(hob => {
                        allhobbies.push({age: a, status: statusList.indexOf(value.status), hobby: hobbyList.indexOf(hob), occupation: occupationList.indexOf(value.occupation), city: cities.indexOf(value.city)});
                    })
                }
            });
            
            var inputs = []
            var outputs = []
            var testArray = []
            
            if(myProfile.city && req.query.region == 'true'){
                
                inputs = allhobbies.map(d => [d.age, d.status, d.occupation, d.city])
                outputs = allhobbies.map(d => d.hobby);
                
                dataset.forEach(blk=>{
                    for(let i = 0; i< blk.length; i++){
                        var a = blk[i][0]
                        if(a >= age-5 && a<= age+5){
                            inputs.push([a, blk[i][1], blk[i][3], cities.indexOf(blk[i][4])])//age, status, occupation, city
                            outputs.push(blk[i][2])//hobby
                            console.log(a, blk[i][1], blk[i][3], cities.indexOf(blk[i][4]))
                        }
                    }
                })
                
                testArray = [age, status, occupation, cities.indexOf(myProfile.city)]

            }else{
                inputs = allhobbies.map(d => [d.age, d.status, d.occupation])
                outputs = allhobbies.map(d => d.hobby);
    
                dataset.forEach(blk=>{
                    for(let i = 0; i< blk.length; i++){
                        var a = blk[i][0]
                        if(a >= age-5 && a<= age+5){
                            inputs.push([a, blk[i][1], blk[i][3]])//age, status, occupation
                            outputs.push(blk[i][2])//hobby
                            console.log(a, blk[i][1], blk[i][3])
                        }
                    }
                })
                
                testArray = [age, status, occupation]
            }
            console.log('test :',testArray )
            
            const inputTensor = tf.tensor2d(inputs, [inputs.length, inputs[0].length]);
            const targetTensor = tf.oneHot(tf.tensor1d(outputs, 'int32'), hobbyList.length);
            
            const model = tf.sequential(); 
            model.add(tf.layers.dense({inputShape: [inputs[0].length], units: parseInt(hobbyList.length * 1.8), useBias: true, activation: 'mish'}));
            model.add(tf.layers.dense({units: parseInt(hobbyList.length * 1.8), useBias: true, activation: 'mish'}));
            model.add(tf.layers.dense({units: parseInt(hobbyList.length * 1.4), useBias: true, activation: 'mish'}));
            model.add(tf.layers.dense({units: parseInt(hobbyList.length * 1.4), useBias: true, activation: 'softplus'}));
            model.add(tf.layers.dense({units: hobbyList.length, useBias: true, activation: 'softmax'}));
            
            model.compile({loss: "categoricalCrossentropy", metrics: ['accuracy'], optimizer: tf.train.adam(0.01)});
            
            var acc;
            var prev = 0;
            var c = 1;
            
            await model.fit(inputTensor, targetTensor, {
                batchSize: 10,
                epochs: 500,
                callbacks:{
                    onEpochEnd: async(epoch, logs) =>{
                        acc = logs.acc
                        c = (parseInt(acc * 100) == prev) ? c+1 : 1
                        prev = parseInt(acc*100)
                        console.log("Epoch: " + epoch + " Loss: " + (logs.loss).toFixed(2) + " Accuracy: " + (logs.acc*100).toFixed(2) +' c='+c);

                        if(logs.loss < 1 ||acc >= 0.58 || c >= 12){
                            model.stopTraining = true
                        }
                    }
                }
              });
        
            acc = acc * 100  
            console.log('Accuracy='+ (acc)+'%')
                

            const testVal = tf.tensor2d(testArray, [1, testArray.length]);

            const prediction = model.predict(testVal);            
            
            const values = prediction.dataSync();
            const arrHobbies = hobbyList;  //hobbies
            const arr = Array.from(values);//their respective probablities
            
            
            //bubble sort to find the top three hobbies with highest probabilities
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
            
            var suggested = [];
            var count = 0;
            for(let i=0; i<arrHobbies.length; i++){
                if(!(myHobbies.includes(arrHobbies[i])) && count < 3)
                {
                    suggested.push(arrHobbies[i])
                    count ++;
                }
            }
            
            
            var result = {
                age: age, 
                status: statusList[status], 
                occupation: occupationList[occupation],
                hobbies: myHobbies, 
                suggested: suggested, 
                accuracy: acc
            }
            if(myProfile.city && req.query.region == 'true'){
                result.city = myProfile.city
            }
            
            return res.json(result);
            
           
        }catch(err){
        
        console.log(err.msg);
        res.status(500).send('Server error!');
    }
});

module.exports = router;
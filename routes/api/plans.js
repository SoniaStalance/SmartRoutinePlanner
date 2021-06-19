const express = require('express');
const router = express.Router();
const auth = require('../../middleware/auth');
const {check, validationResult} = require('express-validator');

const User = require('../../models/User');
const Plan = require('../../models/Plan');

const tf = require('@tensorflow/tfjs');
const config = require('config');
const { ExpandDims } = require('@tensorflow/tfjs');

//common members for create/update plans
    const categories = ['sleep', 'fitness', 'refreshment', 'work', 'chores', 'social', 'leisure', 'hobby', 'others', 'idle'];
    //                      0       1           2             3         4        5          6         7         8       9
    var suggestions = [];
    const months = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"]; 
    const countOccurrences = (arr, val) => arr.reduce((a, v) => (v === val ? a + 1 : a), 0); //func to find freq of values in an array

    function getRoutineByDate(userPlanner, reqDate = new Date()){
        var flag = false
        
        var routineX = {}
        routine = userPlanner.routine;

        routine.forEach(r => {
            dt = (r.date).getDate();
            mt = (r.date).getMonth();
            yr = (r.date).getFullYear();

            if(dt == reqDate.getDate() && mt == reqDate.getMonth() && yr == reqDate.getFullYear()){
                flag = true
                routineX = r
            }
        })

        return {flag: flag, routineX: routineX}
    }

    function validateInput(myRoutine){
        var flag = 0;
        myRoutine.forEach(p => {        
            if(p.startTimeH == null || p.startTimeM == null || p.endTimeH == null || p.endTimeM == null || p.category == null || p.task == null){
                flag = 1;
            }
            if(p.priority == null){
                p.priority = 'low'
            }
            if(p.done == null){
                p.done = false
            }
            })
        return flag;
    }

    //func to prepare skeleton of plans
    function prepare(myRoutine){
        var categorySlots = new Array(288).fill(-1);
        
        myRoutine.forEach(p =>{
            var start = ((parseInt(p.startTimeH) * 12) + (parseInt(p.startTimeM) / 5));
            var end   = ((parseInt(p.endTimeH) * 12) + (parseInt(p.endTimeM) / 5));
            if(start == 287){
                
                categorySlots[287] = categories.indexOf(p.category);
            }
            else{
                for (let i = start; i < end; i++){
                    
                    categorySlots[i] = categories.indexOf(p.category);
                }
            }
        })
        
        return categorySlots
    }

    function findIdleTime(categorySlots, myRoutine){
        for(let i=0; i< categorySlots.length; i++){
            if(categorySlots[i] == -1){
                index = i;
                while(categorySlots[index] == -1){
                    index++;
                }
                var start = i;
                var end = index;
                var startTimeH = parseInt(start/12);
                var startTimeM = (start - (startTimeH * 12)) * 5;
                var endTimeH = parseInt(end/12);
                var endTimeM = (end - (endTimeH * 12)) * 5;

                myRoutine.push({startTimeH: startTimeH, startTimeM: startTimeM, endTimeH: endTimeH, endTimeM: endTimeM , category: "idle", task: "none", priority: "low", done: false});
                i = index;
                continue;
            }
        }
        return myRoutine;
    }

    function remarks(categorySlots, category, myRoutine){
        catNo = categories.indexOf(category);
        
        var sleep = 0; //default
        var sug = '';
        switch(category){
            case 'sleep': {
                
                sleep = (countOccurrences(categorySlots, catNo) / 12).toFixed(1); //default is replaced by users sleeping hrs
                sug += 'Consider sleeping for '+(7 - sleep).toFixed(1) +' hours during the following intervals:';
                
                break;
            }
            case 'fitness': {
                
                sug += 'Consider following a fitness routine for atleast 1/2 an hour during the following intervals:';
                
                break;
            }
        }

        if((category == 'fitness' && !categorySlots.includes(catNo)) || (category == 'sleep' && sleep < 7))  {
            myRoutine.forEach(r => {
                if(r.category == 'idle'){
                    var start = ((parseInt(r.startTimeH) * 12) + (parseInt(r.startTimeM) / 5));
                    var end   = ((parseInt(r.endTimeH) * 12) + (parseInt(r.endTimeM) / 5));
                    if(((end - start) * 6) >= 30)
                        sug = sug.concat(' < ' + r.startTimeH + ':' + r.startTimeM + ' to ' + r.endTimeH + ':' + r.endTimeM + ' > ')
                }
            })
            suggestions.push(sug);
        }
    }

    function refreshments(categorySlots, value){
        if(!(categorySlots.includes(categories.indexOf('refreshment'))))
            suggestions.push('Kindly include a refreshment in your '+value+' routine')
            //console.log(categorySlots)
    }

    function completionScore(categorySlots, myRoutine){
        var TW = 0; //total weight
        var w = 0;  //weight completed
        myRoutine.forEach(r => {
            if(r.category != 'idle'){
                TW = (r.priority == 'low') ? (TW+1) : (TW+2);

                if(r.done == true){
                    w = (r.priority == 'low') ? (w+1) : (w+2);
                }
            }
            
        })
        
        
        //reductions
        var sleep = (countOccurrences(categorySlots, categories.indexOf('sleep')) / 12).toFixed(1);
        if(!categorySlots.includes(categories.indexOf('sleep')))
        {
            w = w - 0.75; //because sleep is highly essential
        }

        if(!categorySlots.includes(categories.indexOf('refreshment')))
        {
            w = w - 0.75; //because refreshments(i.e. meals) are highly essential
        }
        return (w/TW)*100;
    }

//common members for create/update plans ends here------------

//create new planner
//create new routine

router.post('/', auth,
async (req, res) => {
    
    //checking if all fields are filled
    var flag = validateInput(req.body);
    
    if(flag != 0){
        return res.status(400).json({errors: 'Incomplete details! One or more fields have not been filled!'});
    }

    var myRoutine = req.body;
    
    
    var categorySlots = prepare(myRoutine);
    myRoutine = findIdleTime(categorySlots, myRoutine);

    
    categorySlots = prepare(myRoutine);
    
    //console.log(categorySlots);
    
    suggestions = [];
    remarks(categorySlots, 'sleep', myRoutine);
    remarks(categorySlots, 'fitness', myRoutine);

    refreshments(categorySlots.slice(0,144), 'morning')
    refreshments(categorySlots.slice(132,216), 'afternoon/evening')
    refreshments(categorySlots.slice(204), 'late-evening')
    
    const cs = completionScore(categorySlots ,myRoutine);
    
    const newRoutine = {
        plan: myRoutine,
        remarks: suggestions,
        score: cs
    };
    
    const userPlanner = await Plan.findOne({user: req.user.id})

    //create new planner for first time user
    //save her day's routine with its plan
    if(!userPlanner){
        try{
            planner = new Plan({user: req.user.id});
            planner.routine.push(newRoutine);
            await planner.save();
            res.json(planner);
        }catch(err){
            console.error(err.message);
            res.status(500).send('Server error');
        }
    }
    else{
        //checking if today's routine already exists
        //if yes send error msg else save today's routine
        var today = getRoutineByDate(userPlanner).flag
        if(today == true){
            return res.status(400).json({errors: 'Today\'s routine already exists'});
        }
        else{
            try{
            if((userPlanner.routine).length > 365){
                //removes the first plan from top
                userPlanner.routine.shift();
            }

            userPlanner.routine.push(newRoutine);
            await userPlanner.save();
            res.json((userPlanner.routine).slice(-1));
            }catch(err){
                console.error(err.message);
                res.status(500).send('Server error');
            }
        }
        
    }
});

//get plan by date
router.get('/', auth, async (req,res)=>{
    try{
        var dt = new Date((req.query).date)
        console.log(dt)
        const userPlanner = await Plan.findOne({user: req.user.id})
        
        if(!userPlanner){
            
            return res.status(400).json({msg: 'There is no planner for this user. Kindly create one.'});
        }

        var obj = getRoutineByDate(userPlanner, dt)
        if(obj.flag == true)
            res.json(obj.routineX);
        else
            return res.status(400).json({msg: 'Plan not found!'});

    }catch(err){
        
        console.log(err.msg);
        res.status(500).send('Server error!');
    }
});

//delete routine obj by id
router.delete('/delete/:routine_id', auth, async (req,res)=>{
    try{
        const userPlanner = await Plan.findOne({user: req.user.id})
        userPlanner.routine.id(req.params.routine_id).remove(); 

        await userPlanner.save();
        return res.status(200).json({msg: 'Routine deleted'})
        
    }catch(err){
        
        console.log(err.msg);
        res.status(500).send('Server error!');
    }
});

//update routine plan, score, remarks by routine obj id
router.post('/update/:routine_id', auth,
async (req, res) => {
    
    //checking if all fields are filled
    var flag = validateInput(req.body);
    
    if(flag != 0){
        return res.status(400).json({errors: 'Incomplete details! One or more fields have not been filled!'});
    }

    var myRoutine = req.body;
    try{
        
    var categorySlots = prepare(myRoutine);
    myRoutine = findIdleTime(categorySlots, myRoutine);

    
    categorySlots = prepare(myRoutine);
    
    //console.log(categorySlots);
    suggestions = [];
    remarks(categorySlots, 'sleep', myRoutine);
    remarks(categorySlots, 'fitness', myRoutine);    
    

    refreshments(categorySlots.slice(0,144), 'morning')
    refreshments(categorySlots.slice(132,216), 'afternoon/evening')
    refreshments(categorySlots.slice(204), 'late-evening')
    
    const cs = completionScore(categorySlots ,myRoutine);

    const userPlanner = await Plan.findOne({user: req.user.id})
    userPlanner.routine.id(req.params.routine_id).plan = myRoutine
    userPlanner.routine.id(req.params.routine_id).remarks = suggestions
    userPlanner.routine.id(req.params.routine_id).score = cs

    await userPlanner.save();
    res.json(userPlanner.routine.id(req.params.routine_id));
    }catch(err){
            console.error(err.message);
            res.status(500).send('Server error');
    }
});

//rearrange today's routine
router.get('/rearrange', auth, async (req,res)=>{
    try{
        const userPlanner = await Plan.findOne({user: req.user.id})
        var obj = getRoutineByDate(userPlanner)
        
        var flag = obj.flag
        if(flag == true){
            var myRoutine = (obj.routineX).plan

            var current = new Date()
            var hr = current.getHours()
            var min = Math.round(current.getMinutes())
            
            myRoutine.forEach(r => {
                
                if((r.category != 'idle') && (r.endTimeH <= hr) && (r.endTimeM < min) && (r.done == false))
                {   
                    var durationOfPendingTask = ((r.endTimeH * 12) + (r.endTimeM /5)) - ((r.startTimeH * 12) + (r.startTimeM /5)) //calculated in slots
                    pendingCategory = r.category
                    pendingTask = r.task
                    pendingPriority = r.priority

                    var r_index = myRoutine.indexOf(r)
                    var i = r_index + 1
                    var replaced = false
                    while(i < myRoutine.length && replaced == false){
                        if(myRoutine[i].category == 'idle' && (((myRoutine[i].startTimeH == hr) && (myRoutine[i].startTimeM >= min)) || (myRoutine[i].startTimeH > hr)) ){
                            var durationOfIdleTask = ((r.endTimeH * 12) + (r.endTimeM /5)) - ((r.startTimeH * 12) + (r.startTimeM /5)) //calculated in slots
                            if(durationOfIdleTask >= (durationOfPendingTask - 15)){
                                myRoutine[i].category = pendingCategory
                                myRoutine[i].task = pendingTask
                                myRoutine[i].priority = pendingPriority
                                myRoutine[i].done = false
                                replaced = true
                            }
                        }
                        i++;
                    }
                    if(replaced == true){
                        myRoutine[r_index].category = 'idle'
                        myRoutine[r_index].task = 'none'
                        myRoutine[r_index].priority = 'low'
                        myRoutine[r_index].done = false
                    }
                }
            })
            var result = obj.routineX
            result.plan = myRoutine
            return res.json(result)
        }
        else{
            return res.status(400).json({msg: 'You have not created any plans for today. Kindly do so.'})
        }
    }catch(err){
        
        res.status(500).send('Server error!');
    }
});

//feedback to routine using date
router.post('/feedback', auth, async (req,res)=>{
    try{
        var dt = new Date((req.body).date)
        const userPlanner = await Plan.findOne({user: req.user.id})
        if(userPlanner)
        {
            var obj = getRoutineByDate(userPlanner, dt)
            var flag = obj.flag
            if(flag == true){
                userPlanner.routine.id(obj.routineX._id).feedback = (req.body.feedback).toString();
                await userPlanner.save();
                return res.status(200).json({msg: 'Feedback submitted!'})
            }
            else{
                return res.status(400).json({msg: 'Plan not found'})
            }
        }else{
            return res.status(400).json({msg: 'There is no planner for this user'})
        }
        
        
        
    }catch(err){
        
        console.log(err.msg);
        res.status(500).send('Server error!');
    }
});

//get stats for the last week (i.e. last 7 days) or for required month
router.get('/stats/:statsRequired', auth, async (req,res)=>{
    try{
        const routine = (await Plan.findOne({user: req.user.id})).routine
        if(!routine){
            return res.status(400).json({msg: 'Routine does not exist'})
        }
        else{
            var statsRequired = (req.params.statsRequired).toLowerCase()
            if(statsRequired == 'week'){
                if(routine.length >= 7){
                    var week = []
    
                    var c = 0;
                    var i = routine.length -1
                    while(c < 7 && i >= 0){
                        var r = routine[i]
                        var dt = (r.date).getDate() + '/' + ((r.date).getMonth() + 1) + '/' + ((r.date).getFullYear())
                        var score = parseFloat(r.score)
                        week.push([dt, score])
                        i--
                        c++
                    }
                    
                    return res.json(week)
                }
                else{
                    return res.status(400).json({msg: 'Insufficient data'})
                }
            }
            else{
                if(months.includes(statsRequired)){
                    var flag = false
                    var m = months.indexOf(statsRequired)
                    var y = 0
                    var i = routine.length -1
                    //get the most recent year associated with the month requested
                    while(flag == false && i >= 0){
                        var r = routine[i]
                        if((r.date).getMonth() == m){
                            y = (r.date).getFullYear()
                            flag = true
                        }
                        i--;
                    }

                    if(flag == true){
                        var month = []
                        for(let i = 0; i < routine.length; i++){
                            var dt = routine[i].date
                            if(dt.getMonth() == m && dt.getFullYear() == y){
                                month.push([dt.getDate(), parseFloat(routine[i].score)])
                            }
                        }

                        return res.json(month)
                    }
                    else{
                        return res.status(400).json({msg: 'Stats for '+months[m]+' does not exist'})
                    }
                }
                else{
                    return res.status(400).json({msg: 'Invalid parameter'})
                }
            }
        }
        
    }catch(err){
        
        console.log(err.msg);
        res.status(500).send('Server error!');
    }
});

module.exports = router;
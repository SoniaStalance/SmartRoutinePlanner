const express = require('express');
const router = express.Router();
const auth = require('../../middleware/auth');
const {check, validationResult} = require('express-validator');

const User = require('../../models/User');
const Plan = require('../../models/Plan');

const tf = require('@tensorflow/tfjs');
const config = require('config');

//common members for create/update plans
    const categories = ['sleep', 'fitness', 'refreshment', 'work', 'chores', 'social', 'leisure', 'hobby', 'others', 'idle'];
    //                      0       1           2             3         4        5          6         7         8       9
    var suggestions = [];

    const countOccurrences = (arr, val) => arr.reduce((a, v) => (v === val ? a + 1 : a), 0); //func to find freq of values in an array

    function validateInput(myRoutine){
        var flag = 0;
        myRoutine.forEach(p => {        
            if(p.startTime == null || p.endTime == null || p.category == null || p.task == null){
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
        var categorySlots = new Array(24).fill(-1);
        var planIndices = new Array(24).fill(-1);
        myRoutine.forEach(p =>{
            for (let i = parseInt(p.startTime); i < parseInt(p.endTime); i++){
                planIndices[i] = (myRoutine).indexOf(p);
                categorySlots[i] = categories.indexOf(p.category);
            }
        })
        return {planIndices: planIndices, categorySlots: categorySlots}
    }

    function findIdleHours(planIndices, myRoutine){
        for(let i=0; i< planIndices.length; i++){
            if(planIndices[i] == -1){
                index = i;
                while(planIndices[index] == -1){
                    index++;
                }
                myRoutine.push({startTime: i.toString(), endTime: index.toString(), category: "idle", task: "none", priority: "low", done: false});
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
                
                sleep = countOccurrences(categorySlots, catNo); //default is replaced by users sleeping hrs
                sug += 'Consider sleeping for '+(7 - sleep)+' hours during the following intervals:';
                
                break;
            }
            case 'fitness': {
                
                sug += 'Consider following a fitness routine for atleast 1 hour during the following intervals:';
                
                break;
            }
        }

        if((category == 'fitness' && !categorySlots.includes(catNo)) || (category == 'sleep' && sleep < 7))  {
            myRoutine.forEach(r => {
                if(r.category == 'idle'){
                    sug = sug.concat(' < ' + r.startTime + ':00 to ' + r.endTime + ':00 > ')
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

    function completionScore(myRoutine){
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
    
    var skeleton = prepare(myRoutine);
    var planIndices = skeleton.planIndices;
    var categorySlots = skeleton.categorySlots;

    myRoutine = findIdleHours(planIndices, myRoutine);

    skeleton = prepare(myRoutine);
    planIndices = skeleton.planIndices;
    categorySlots = skeleton.categorySlots;
    
    
    console.log(planIndices);
    console.log(categorySlots);
    
    suggestions = [];
    remarks(categorySlots, 'sleep', myRoutine);
    remarks(categorySlots, 'fitness', myRoutine);

    refreshments(categorySlots.slice(0,12), 'morning')
    refreshments(categorySlots.slice(11,18), 'afternoon/evening')
    refreshments(categorySlots.slice(17), 'late-evening')
    
    const cs = completionScore(myRoutine);
    
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
        flagC = 0;
        today = new Date();
        todaysRoutine = userPlanner.routine;

        todaysRoutine.forEach(r => {
            dt = (r.date).getDate();
            mt = (r.date).getMonth();
            yr = (r.date).getFullYear();

            if(dt == today.getDate() && mt == today.getMonth() && yr == today.getFullYear()){
                flagC = 1;
            }
        })
        
        if(flagC != 0){
            return res.status(400).json({errors: 'Today\'s routine already exists'});
        }
        else{
            try{
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

//get user's entire planner
router.get('/', auth, async (req,res)=>{
    try{
        
        const userPlanner = await Plan.findOne({user: req.user.id})
        
        if(!userPlanner){
            
            return res.status(400).json({msg: 'There is no planner for this user. Kindly create one.'});
        }
        
        res.json(userPlanner.routine);
    }catch(err){
        
        console.log(err.msg);
        res.status(500).send('Server error!');
    }
});

//get daily routine by obj id
router.get('/:routine_id', auth, async (req,res)=>{
    try{
        const routineX = (await Plan.findOne({user: req.user.id})).routine.id(req.params.routine_id)
        if(routineX)
            return res.json(routineX)
        else
            return res.status(400).json({msg: 'Routine does not exist'})
        
    }catch(err){
        
        console.log(err.msg);
        res.status(500).send('Server error!');
    }
});

//delete routine obj by id
router.delete('/:routine_id', auth, async (req,res)=>{
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
router.post('/:routine_id', auth,
async (req, res) => {
    
    //checking if all fields are filled
    var flag = validateInput(req.body);
    
    if(flag != 0){
        return res.status(400).json({errors: 'Incomplete details! One or more fields have not been filled!'});
    }

    var myRoutine = req.body;
    try{
        
    var skeleton = prepare(myRoutine);
    var planIndices = skeleton.planIndices;
    var categorySlots = skeleton.categorySlots;

    myRoutine = findIdleHours(planIndices, myRoutine);

    skeleton = prepare(myRoutine);
    planIndices = skeleton.planIndices;
    categorySlots = skeleton.categorySlots;
    
    
    console.log(planIndices);
    console.log(categorySlots);

    suggestions = [];
    remarks(categorySlots, 'sleep', myRoutine);
    remarks(categorySlots, 'fitness', myRoutine);    
    

    refreshments(categorySlots.slice(0,12), 'morning')
    refreshments(categorySlots.slice(11,18), 'afternoon/evening')
    refreshments(categorySlots.slice(17), 'late-evening')
    
    const cs = completionScore(myRoutine);

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

module.exports = router;
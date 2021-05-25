const express = require('express');
const router = express.Router();
const auth = require('../../middleware/auth');
const Profile = require('../../models/Profile');
const User = require('../../models/User');
const {check, validationResult} = require('express-validator');
const tf = require('@tensorflow/tfjs');
const dataset = require('../../data/userdata');
/*
GET api/profile/me
get current user's profile 
private
*/
router.get('/me', auth, async (req,res)=>{
    try{
        
        const profile = await Profile.findOne({user: req.user.id}).populate('user', ['name', 'avatar']);
        
        if(!profile){
            
            return res.status(400).json({msg: 'There is no profile for this user'});
        }
        
        res.json(profile);
    }catch(err){
        
        console.log(err.msg);
        res.status(500).send('Server error!');
    }
});

/*
POST api/profile
create or update a user profile 
private
*/
router.post('/', [auth, [
    check('age','age is required').not().isEmpty(),
    check('status','status is required').not().isEmpty(),
    check('pincode','pincode is required').not().isEmpty()
    

]], async (req,res)=>{
    const errors = validationResult(req);
    if(!errors.isEmpty()){
        return res.status(400).json({errors: errors.array()});
    }
    
    const {
        age,
        occupation,
        status,
        hobbies,
        pincode
    } = req.body;

    //build profile object
    const profileFields = {};
    profileFields.user = req.user.id;
    profileFields.age = age;
    profileFields.status = status;
    profileFields.pincode = pincode;
    if (occupation) profileFields.occupation = occupation;

    if(hobbies){
        profileFields.hobbies = hobbies.split(',').map(skill => skill.trim());
    }

    try{
        let profile = await Profile.findOne({user: req.user.id});
        if(profile){
            //update
            profile = await Profile.findOneAndUpdate({user: req.user.id}, {$set: profileFields}, {new: true});
            return res.json(profile);
        }

        //else create a new profile
        profile = new Profile(profileFields);
        await profile.save();
        res.json(profile);

    }catch(err){
        console.log(err.msg);
        res.status(500).send('Server error');
    }
})

module.exports = router;

//-------------------------------------------
/*
GET api/profile
get all profiles (not required now.. maybe later on if required will use for admin side)
public
*/

router.get('/', async(req, res)=>{
    try{
        const profiles = await Profile.find().populate('user', ['name', 'avatar']);
        res.json(profiles);
    }catch(err){
        console.log(err.msg);
        res.status(500).send('Server Error');
    }
});

/*
GET api/profile/user/:user_id
get profile by user_id
public
*/

router.get('/user/:user_id', async(req, res)=>{
    try{
        const profile = await Profile.findOne({ user: req.params.user_id}).populate('user', ['name', 'avatar']);
        if(!profile){
            return res.status(400).json({msg: 'Profile not found'})
        }
        res.json(profile);
    }catch(err){
        if(err.kind == 'ObjectId'){
            return res.status(400).json({msg: 'PROFILE NOT FOUND'})
        }
        else{
        console.log(err.msg);
        res.status(500).send('Server Error');
        }
    }
});

//-----------------------------------------------
/*
DELETE api/profile
DELETE profile, user, plans
private
*/

router.delete('/', auth, async(req, res)=>{
    try{
        //Remove Profile
        await Profile.findOneAndRemove({user: req.user.id});
        //Remove User
        await User.findOneAndRemove({_id: req.user.id});
        //Remove User's Entire Planner
        await Plan.findOneAndRemove({user: req.user.id});
        res.json({msg: 'User Removed'})
    }catch(err){
        console.log(err.msg);
        res.status(500).send('Server Error');
    }
});
//-------------------------------------------------------------------------

//suggest hobby for logged in user based on already saved model(not real-time though)
//pending (don't bother)
/*
router.get('/suggest_hobbies', auth, async (req,res)=>{
    try{
        
        const profile = await Profile.findOne({user: req.user.id}).populate('user', ['name', 'avatar']);
        
        if((profile.hobbies).length==0){
            //load hobbies model
            //predict
            
            const testVal = tf.tensor2d([53, 1], [1, 2]);

            const prediction = model.predict(testVal);
            console.log((prediction).print())

            const ix = tf.argMax(prediction, axis=1).dataSync();
            suggestedHobby = hobbyList[ix];
            console.log('This user has no hobbies! Hobby suggested is ' + suggestedHobby );
            
            return res.status(400).json({msg: '[INCOMPLETE] This user has no hobbies!', suggested: 'suggestedHobby'});
        }
        res.json(profile.hobbies);
    }catch(err){
        
        console.log(err.msg);
        res.status(500).send('Server error!');
    }
});
*/
module.exports = router;
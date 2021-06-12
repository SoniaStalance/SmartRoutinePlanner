const express = require('express');
    const router = express.Router();
    const {check, validationResult} = require('express-validator');
    const User = require('../../models/User');
    const gravatar = require('gravatar');
    const bcrypt = require('bcryptjs');
    const jwt = require('jsonwebtoken');
    const config = require('config');
    const auth = require('../../middleware/auth');



    router.post('/',
    [
        check('name','Name is required').not().isEmpty(),
        check('email','Enter vaild email').isEmail(),
        check('password','Min password length is 6').isLength({min: 6}),
        check('dupliPassword','Min password length is 6').isLength({min: 6})
    ],
    async (req,res)=>{
        const errors = validationResult(req);
        if(!errors.isEmpty())
        {
            return res.status(400).json({errors: errors.array()})
        }

        const {name, email, password, dupliPassword, admin} = req.body;        

        try{
            let user = await User.findOne({email});
            if(user){
                return res.status(400).json({errors:[{msg: 'User already exits!'}]});
            }

            const avatar = gravatar.url(email,{
                s:"200",
                r:"pg",
                d:"mm"
            });

            userFields = {
                name,
                email,
                avatar,
                password,
                dupliPassword
            };

            if(admin){
                if(admin == true || admin == false){
                    userFields.admin = admin
                }
            }
            console.log(userFields.admin)
        
            user = new User(userFields);
            if(password == dupliPassword)
            {
                const salt = await bcrypt.genSalt(10);
                user.password = await bcrypt.hash(password, salt);

                await user.save();

                //return jsonwebtoken
                const payload = {
                    user:{
                        id: user.id
                    }
                }

                jwt.sign(payload, config.get('jwtSecret'), {expiresIn: 360000},
                (err, token) => {
                    if(err) throw err;
                    res.json({token})
                });
            }
            else{
                return res.json('Passwords do not match!')
            }

        }catch(err){
            console.log(err.message);
            res.status(500).send('Server error');
        }
        
    });

    //change password
    router.post('/password',
    [
        check('currentPassword','Enter current password').exists(),
        check('newPassword','Min password length is 6').isLength({min: 6}),
        check('dupliPassword','Min password length is 6').isLength({min: 6})
    ],
    auth,
    async (req,res)=>{
        const errors = validationResult(req);
        if(!errors.isEmpty())
        {
            return res.status(400).json({errors: errors.array()})
        }

        const {currentPassword, newPassword, dupliPassword} = req.body;

        try{
            let user = await User.findOne({_id: req.user.id});
            if(!user){
                return res.status(400).json({errors:[{msg: 'User does not exist'}]});
            }

            const isMatch = await bcrypt.compare(currentPassword, user.password);

            if(!isMatch){
                return res.status(400).json({errors: [{msg: 'Current password is incorrect!'}]});
            }else
            {
                if(newPassword == dupliPassword){
                    if(newPassword == currentPassword){
                        return res.json('New password cannot be same as the current password')
                    }
                    const salt = await bcrypt.genSalt(10);
                    user.password = await bcrypt.hash(newPassword, salt);

                    await user.save();
                    return res.json('Password changed!')
                }
                else{
                    return res.status(400).json({errors: [{msg: 'Passwords do not match!'}]});
                }
            }
        }catch(err){
            console.log(err.message);
            res.status(500).send('Server error');
        }
        
    });

    module.exports = router;
const express = require('express');
var bodyParser = require('body-parser')
const app = express();
var http = require('http').Server(app)
var axios = require('axios')
var mongoose = require('mongoose')
const {google} = require('googleapis');

app.use(bodyParser.json())
app.use(bodyParser.urlencoded({ extended: false }))

var port = process.env.PORT || 4000;
var http = require('http').Server(app)
var slackMessageUrl;
var mongoUrl;
var slackToken;
var fcmUrl;
function authenticate(){
	var creds = require('./credentials.json');
	 slackMessageUrl = creds.slackMessageUrl;
	 mongoUrl = creds.mongoUrl;
	 slackToken = creds.slackToken;
	 fcmUrl = creds.fcmUrl;
	 firebaseJson = creds.firebaseJson;
}




authenticate()
mongoose.connect(mongoUrl)

var questionSchema = new mongoose.Schema({
    question: String,
    location: String,
    status: String,
    key: String
  });

var userSchema = new mongoose.Schema({
    fcmToken: String,
    email: String,
    questions: [questionSchema]
})

var waitStatus = "Awaiting available mentors"

var User = mongoose.model('User', userSchema);
var Question = mongoose.model('Question', questionSchema);

app.post("/", function(req, res) {
    console.log("HIT SERVER")
    console.log(req.body);

    // necessary for authentication with Slack API
    if (req.body.challenge) {
        res.send(req.body.challenge)
    }
})

app.get("/", function(req, res) {
    console.log("hit home");
})

app.get("/getquestions/:email", function(req, res) {
    console.log("GETTING QUESTIONS")
    const email = req.params.email;
    console.log(email)
    var user = User.findOne({email: email}, function(err, user) {
        if (user){
            console.log("USER FOUND")
            console.log(JSON.stringify(user.questions))
            res.status(200).send(JSON.stringify(user.questions))
        } else {
            res.status(200).send(JSON.stringify([]));
        }
    })
})

// gets the actual name of the user, since the message endpoint only includes their slackname
async function getUserName(user) {
	console.log(user.id)
	console.log(slackToken)
    const slackapi = `https://slack.com/api/users.profile.get?token=${slackToken}&user=${user.id}`
    console.log(slackapi)
    var mentor_name = axios.get(slackapi)
    .then(function (response) {
        return response.data.profile.real_name_normalized;
    }).catch(function (error) {
      console.log(error);
      return user.name
    });
    return mentor_name;
}
// hit when a mentor claims a question on Slack. Sends a push notification to the mobile app
app.post("/claim-question", claimQuestion)

async function claimQuestion(req, res) {
    if (req.body.payload) {
        response = JSON.parse(req.body.payload)
        console.log(response)
        const key = response.actions[0].name
        var name = await getUserName(response.user)
        var question_object = JSON.parse(response.actions[0].value)
        var question_text = question_object.question
        var email = question_object.email
        res.status(200).send({'text': `${question_object.requester_name}'s question: "${question_text}" has been claimed by ${name}! \n${question_object.requester_name} can be found at ${question_object.location}`})
        User.findOne({email:email}, async (err, user) => {
            if (err) {
                console.log(err)
           }
            // update question's status in DB
            user.questions.forEach(function(v, i) {
                if (user.questions[i].key == key) {
                    user.questions[i].status = `${name} has claimed your question!`
                }
             });
            user.save();
            var accessToken = await getAccessToken();
            console.log("ACCESS TOKEN")
            console.log(accessToken)
            let axiosConfig = {
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': 'Bearer ' + accessToken,
                }
            };
            var notification_data = {
                "message": {
                "notification": {
                  "body": `Your question: ${question_text} has been claimed! ${name} is on their way to your location now!`,
                  "title": "Bitcamp Mentorship"
                    },
                "data": {
                    "question": question_text,
                    "mentor_name": name,
                    "key": key,
                    "email": email
                },
                "token" : user.fcmToken  
                }
            }
            axios.post(new String(fcmUrl), notification_data, axiosConfig)
            .then(function (response) {
                console.log("SUCCESS")
               // console.log(response);
              })
              .catch(function (error) {
                console.log("Error sending push notification!")
                console.log(error);
              });
        })
    }
}

// stores question in database and sends message to slack channel
app.post("/question", function(req, res) {
    var question = req.body.question;
    var questionString = JSON.stringify({email: req.body.email, question: question, requester_name: req.body.name, location: req.body.location })
    var data = 
    {
        "attachments":     [
        {
            "pretext" : `New Mentorship Request!`,
            "text": `${req.body.name} has a question: "${question}" \nLocation: ${ req.body.location} \n Slack Username: ${req.body.slackUsername}`,
            "fallback": "You are unable to claim this question",
            "callback_id": "claimquestion",
            "color": "#3AA3E3",
            "attachment_type": "default",
            "actions": [
        {
            "name": req.body.key,
            "text": "Claim Question",
            "type": "button",
            "value": questionString
        }]}
    ]}

    // check if user exists in db. if not, create new entry. Otherwise, add new question for user
    console.log("EMAIL IS")
    console.log(req.body.email)
    User.findOne({email:req.body.email}, function(err, user) {
        if (user) {
            console.log(user)
            user.questions.unshift({ question: req.body.question, key: req.body.key, status: waitStatus, location: req.body.location})
            user.fcmToken = req.body.fcmToken
            user.save()
        } else {
            const questions = [{ question: req.body.question, key: req.body.key, status: waitStatus, location: req.body.location }]
            var q =  new User({email: req.body.email, fcmToken: req.body.fcmToken, questions: questions})   
            q.save()
        }
    })
    axios.post(slackMessageUrl, data)
})

http.listen(port, function() {
    console.log('Example app listening on port '+ port )
});

// get access token for use with push notfications (Google FCM)
function getAccessToken() {
    var SCOPES = ['https://www.googleapis.com/auth/cloud-platform']
    return new Promise(function(resolve, reject) {
      var key = require(firebaseJson);
      var jwtClient = new google.auth.JWT(
        key.client_email,
        null,
        key.private_key,
        SCOPES,
        null
      );
      jwtClient.authorize(function(err, tokens) {
        if (err) {
        console.log("REJECT")
          reject(err);
          return;
        }
        resolve(tokens.access_token);
      });
    });
  }
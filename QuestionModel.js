var mongoose = require('mongoose')
var questionSchema = new mongoose.Schema({
    question: String,
    fcmToken: String
  });

export default questionSchema 
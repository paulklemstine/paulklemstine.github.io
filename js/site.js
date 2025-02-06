const hours = new Date().getHours() // get the current hour

const isMorning = hours >= 4 && hours < 12 // is it morning?
const isAfternoon = hours >= 12 && hours < 17 // is it afternoon?
const isEvening = hours >= 17 || hours < 4 // is it evening?

var message;
if (isMorning) message = 'Good Morning!'
else if (isAfternoon) message = 'Good Afternoon!'
else if (isEvening) message = 'Good Evening!'

const welcomeDiv =document.querySelector("#welcome")
welcomeDiv.innerHTML = message

//set a secret message
const key="It's a secret to everybody."
const response="Shhh... it's a Punch and Judy kind of secret."
localStorage.setItem(key,response);
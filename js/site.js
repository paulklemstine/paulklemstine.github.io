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

//carousel
const urls = [
    'https://images.pexels.com/photos/1454360/pexels-photo-1454360.jpeg?auto=compress&cs=tinysrgb&w=1260&h=750&dpr=1',
    'https://images.pexels.com/photos/933964/pexels-photo-933964.jpeg?auto=compress&cs=tinysrgb&w=1260&h=750&dpr=1',
    'https://images.pexels.com/photos/267885/pexels-photo-267885.jpeg?auto=compress&cs=tinysrgb&w=1260&h=750&dpr=1',
    'https://images.pexels.com/photos/1251861/pexels-photo-1251861.jpeg?auto=compress&cs=tinysrgb&w=1260&h=750&dpr=1',
    'https://images.pexels.com/photos/1370296/pexels-photo-1370296.jpeg?auto=compress&cs=tinysrgb&w=1260&h=750&dpr=1'
].map(url => { (new Image()).src = url; return url })

const images = document.querySelectorAll('#carousel img')

let currentImage = 0
const showImages = () => {
    const offset = currentImage % urls.length
    images.forEach((image, index) => {
        const imageIndex = (index + offset + urls.length) % urls.length
        image.src = urls[imageIndex]
    })
}

//initialize carousel
showImages()

//advance the carousel every 5 seconds
let id = setInterval(() => {
    currentImage = (currentImage+1)%urls.length;
    showImages();
}, 5000)

// prev button clicked
const btnPrev = document.getElementById('prev');
btnPrev.addEventListener('click',() =>{
    currentImage = (currentImage-1)%urls.length;
    showImages();
});

//next button clicked
const btnNext = document.getElementById('next');
btnNext.addEventListener('click',() =>{
    currentImage = (currentImage+1)%urls.length;
    showImages();
});


//to do list

//look up todo-list from localStorage and display it in the hthml
const renderTodos = () =>{
    const todos = JSON.parse(localStorage.getItem('todo-list')) || []
    const todoList = document.querySelector('.todo-list')
    todoList.innerHTML = ''
    todos.forEach(todo =>{
        const li = document.createElement('li')
        li.textContent = todo.text
        todoList.append(li)
    })
}

//render todos on init
renderTodos()

//add button click listener, add and save the todo
const addTodo = document.getElementById('add-todo')
addTodo.addEventListener('click',() =>{
    const todos = JSON.parse(localStorage.getItem('todo-list')) || []
    todos.push({ text: document.getElementById('new-todo').value, completed: false })
    localStorage.setItem('todo-list', JSON.stringify(todos))
    renderTodos()
});

//get random pokemon image - Week 8
//IIFE
(async () => {
 
    //return a random pokemon fetched from the pokeapi
    const getRandomPokemon = async () => {
        const url = 'https://pokeapi.co/api/v2/pokemon/' + Math.floor(Math.random() * 150)
        const response = await fetch(url)
        const json = pokemon = await response.json()
        return json
    }

    //render pokemon json to a #pokemon div
    const renderPokemon = pokemon =>{
        const imageDiv=document.getElementById('pokemon');
        const img = document.createElement('img')
        img.src = pokemon.sprites.front_default
        img.alt = pokemon.name
        img.style.border = "none"
        imageDiv.append(img)
    }
    
    //run on init
    const randomPokemon = await getRandomPokemon()
    renderPokemon(randomPokemon)
})()
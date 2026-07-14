let lectures = Number(localStorage.getItem("lectures")) || 0;
let xp = Number(localStorage.getItem("xp")) || 0;

let physics = Number(localStorage.getItem("physics")) || 0;
let chemistry = Number(localStorage.getItem("chemistry")) || 0;
let maths = Number(localStorage.getItem("maths")) || 0;

let tasks = JSON.parse(localStorage.getItem("tasks")) || [];





createLectures();
updateAll();
showTasks();
loadNotes();
updateClock();
countdown();






function sound(){

let s=document.getElementById("clickSound");

if(s){

s.play();

}

}







function createLectures(){

let box=document.getElementById("lectureBox");

box.innerHTML="";


for(let i=1;i<=266;i++){


let c=document.createElement("input");

c.type="checkbox";


c.checked =
localStorage.getItem("lec"+i)=="true";



c.onclick=function(){

sound();


localStorage.setItem(
"lec"+i,
c.checked
);


calculate();

};




let label=document.createElement("label");

label.innerHTML="📚 Lecture "+i;



box.appendChild(c);

box.appendChild(label);


}

}









function calculate(){

let total=0;


for(let i=1;i<=266;i++){

if(localStorage.getItem("lec"+i)=="true"){

total++;

}

}


lectures=total;


xp=lectures*10;


localStorage.setItem("lectures",lectures);

localStorage.setItem("xp",xp);



updateAll();


}









function physicsAdd(){

sound();

physics++;

localStorage.setItem("physics",physics);

updateSubjects();

}





function chemAdd(){

sound();

chemistry++;

localStorage.setItem("chemistry",chemistry);

updateSubjects();

}





function mathAdd(){

sound();

maths++;

localStorage.setItem("maths",maths);

updateSubjects();

}







function updateSubjects(){


document.getElementById("physics").innerHTML=physics;

document.getElementById("chemistry").innerHTML=chemistry;

document.getElementById("maths").innerHTML=maths;



document.getElementById("physicsBar").style.width=
Math.min(physics,100)+"%";


document.getElementById("chemBar").style.width=
Math.min(chemistry,100)+"%";


document.getElementById("mathBar").style.width=
Math.min(maths,100)+"%";


}








function updateAll(){


document.getElementById("count").innerHTML=
lectures+" / 266 Completed";



document.getElementById("lectureBar").style.width=
(lectures/266*100)+"%";



document.getElementById("xp").innerHTML=
"XP : "+xp;



document.getElementById("xpBar").style.width=
Math.min(xp,100)+"%";



document.getElementById("level").innerHTML=
"Level "+(Math.floor(xp/100)+1);



updateBadge();

updateSubjects();


}









function updateBadge(){


let badge="🔒 No Badge";


if(xp>=100){

badge="🥉 Bronze Warrior";

}


if(xp>=500){

badge="🥈 Silver Master";

}


if(xp>=1000){

badge="🥇 JEE Legend";

}



document.getElementById("badges").innerHTML=badge;


}









function missionDone(){

sound();

document.getElementById("mission").innerHTML=
"🔥 Mission Completed";


}








function saveNotes(){

sound();

localStorage.setItem(
"notes",
document.getElementById("notes").value
);


alert("Notes Saved 💾");


}






function loadNotes(){

document.getElementById("notes").value=
localStorage.getItem("notes") || "";

}








function addTask(){

sound();

let t=document.getElementById("task").value;


if(t!=""){


tasks.push(t);


localStorage.setItem(
"tasks",
JSON.stringify(tasks)
);


document.getElementById("task").value="";


showTasks();

}

}







function showTasks(){

let list=document.getElementById("taskList");

list.innerHTML="";


tasks.forEach(function(t){

let li=document.createElement("li");

li.innerHTML="✅ "+t;


list.appendChild(li);


});

}









function updateClock(){

document.getElementById("clock").innerHTML=
new Date().toLocaleString();


}


setInterval(updateClock,1000);








function countdown(){

let exam=new Date("2027-01-01");

let today=new Date();


let days=Math.ceil(
(exam-today)/(1000*60*60*24)
);


document.getElementById("countdown").innerHTML=
days+" Days Remaining 🚀";


}






let ctx=document.getElementById("graph");


if(ctx){

new Chart(ctx,{

type:"line",

data:{

labels:["Mon","Tue","Wed","Thu","Fri","Sat","Sun"],

datasets:[{

label:"Study XP",

data:[20,40,30,70,50,90,100]

}]

}

});

}
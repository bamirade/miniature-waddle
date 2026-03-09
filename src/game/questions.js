const questions = [
  {
    id: 'q001',
    text: 'What is 7 + 5?',
    options: ['10', '11', '12', '13'],
    answerIndex: 2
  },
  {
    id: 'q002',
    text: 'What is 9 × 3?',
    options: ['18', '24', '27', '30'],
    answerIndex: 2
  },
  {
    id: 'q003',
    text: 'What is 15 - 6?',
    options: ['7', '8', '9', '10'],
    answerIndex: 2
  },
  {
    id: 'q004',
    text: 'What is 24 ÷ 6?',
    options: ['3', '4', '5', '6'],
    answerIndex: 1
  },
  {
    id: 'q005',
    text: 'Complete the pattern: 2, 4, 6, ?',
    options: ['7', '8', '9', '10'],
    answerIndex: 1
  },
  {
    id: 'q006',
    text: 'Binary for decimal 5 is:',
    options: ['100', '101', '110', '111'],
    answerIndex: 1
  },
  {
    id: 'q007',
    text: 'Which is an input device?',
    options: ['Monitor', 'Keyboard', 'Speaker', 'Projector'],
    answerIndex: 1
  },
  {
    id: 'q008',
    text: 'Which stores files long-term?',
    options: ['RAM', 'Cache', 'SSD', 'CPU'],
    answerIndex: 2
  },
  {
    id: 'q009',
    text: 'HTML is mainly used to:',
    options: ['Style pages', 'Structure pages', 'Run servers', 'Edit photos'],
    answerIndex: 1
  },
  {
    id: 'q010',
    text: 'CSS is mainly used to:',
    options: ['Style pages', 'Store data', 'Compile code', 'Send email'],
    answerIndex: 0
  },
  {
    id: 'q011',
    text: 'JavaScript in a browser can:',
    options: ['Change page content', 'Replace battery', 'Print paper', 'Fix Wi-Fi hardware'],
    answerIndex: 0
  },
  {
    id: 'q012',
    text: 'Best loop for known repeat count:',
    options: ['for loop', 'while true', 'switch', 'try/catch'],
    answerIndex: 0
  },
  {
    id: 'q013',
    text: 'If x = 10, is x > 7 true?',
    options: ['True', 'False', 'Only in Python', 'Only in C'],
    answerIndex: 0
  },
  {
    id: 'q014',
    text: 'In JavaScript, strict equality is:',
    options: ['==', '=', '===', '=>'],
    answerIndex: 2
  },
  {
    id: 'q015',
    text: 'Smallest unit of data is a:',
    options: ['Byte', 'Bit', 'Word', 'Block'],
    answerIndex: 1
  },
  {
    id: 'q016',
    text: 'How many bits are in 1 byte?',
    options: ['4', '8', '16', '32'],
    answerIndex: 1
  },
  {
    id: 'q017',
    text: 'URL stands for:',
    options: ['Uniform Resource Locator', 'Universal Read Link', 'User Route Level', 'Unified Remote Log'],
    answerIndex: 0
  },
  {
    id: 'q018',
    text: 'Which password is strongest?',
    options: ['password123', 'qwerty', 'Mango!7River#2', 'student'],
    answerIndex: 2
  },
  {
    id: 'q019',
    text: 'All cats are mammals. Luna is a cat. So Luna is a:',
    options: ['Bird', 'Mammal', 'Fish', 'Reptile'],
    answerIndex: 1
  },
  {
    id: 'q020',
    text: 'The opposite branch of if is:',
    options: ['then', 'switch', 'case', 'else'],
    answerIndex: 3
  },
  {
    id: 'q021',
    text: 'First array index in JavaScript is:',
    options: ['0', '1', '-1', 'Depends'],
    answerIndex: 0
  },
  {
    id: 'q022',
    text: 'Print to browser console using:',
    options: ['print()', 'console.log()', 'echo()', 'stdout()'],
    answerIndex: 1
  },
  {
    id: 'q023',
    text: 'Smallest to largest order is called:',
    options: ['Descending', 'Ascending', 'Random', 'Circular'],
    answerIndex: 1
  },
  {
    id: 'q024',
    text: 'What is 3 squared?',
    options: ['6', '8', '9', '12'],
    answerIndex: 2
  },
  {
    id: 'q025',
    text: '90 minutes equals:',
    options: ['1 hour 20 min', '1 hour 30 min', '2 hours', '45 min'],
    answerIndex: 1
  },
  {
    id: 'q026',
    text: '100% of 45 is:',
    options: ['4.5', '22.5', '45', '90'],
    answerIndex: 2
  },
  {
    id: 'q027',
    text: 'True OR False evaluates to:',
    options: ['True', 'False', 'Error', 'Null'],
    answerIndex: 0
  },
  {
    id: 'q028',
    text: 'True AND False evaluates to:',
    options: ['True', 'False', 'Maybe', 'Undefined'],
    answerIndex: 1
  },
  {
    id: 'q029',
    text: 'Which number is odd?',
    options: ['2', '4', '7', '8'],
    answerIndex: 2
  },
  {
    id: 'q030',
    text: 'Which number is prime?',
    options: ['9', '10', '11', '12'],
    answerIndex: 2
  }
];

function getRandomQuestion(excludeIdsSet = new Set()) {
  const excluded = excludeIdsSet instanceof Set
    ? excludeIdsSet
    : new Set(excludeIdsSet || []);

  const available = questions.filter((question) => !excluded.has(question.id));
  const pool = available.length > 0 ? available : questions;
  const randomIndex = Math.floor(Math.random() * pool.length);
  return pool[randomIndex];
}

module.exports = {
  questions,
  getRandomQuestion
};

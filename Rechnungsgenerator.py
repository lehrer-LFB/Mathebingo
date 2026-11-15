# Kern des Mathe Bingo Spiels

# import random module
import random

# initialize random
random.seed()

# zufallszahlen 
a = random.randint(1,10)
b = random.randint(1,10)
y = random.randint(1,100)

z = a*b

if z < y:  
    d = y-z
    x = a*b+d

elif z >= y:
    d = z-y
    x = a*b-d
    
# print random value
print(a)
print(b)
print(d)
print(x)
print(y)
print(z)
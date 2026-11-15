import tkinter as tk
from tkinter import ttk, messagebox
import random
import json
import os
from datetime import datetime
import threading
import time

class MatheBingoGUI:
    def __init__(self, root):
        self.root = root
        self.root.title("Mathe Bingo Generator")
        self.root.geometry("800x600")
        
        # Daten für das Spiel
        self.used_results = set()  # Starte mit leerem Ergebnisspeicher
        self.current_task = None
        self.results_file = "bingo_results.json"
        
        # Timer-Variablen
        self.timer_running = False
        self.timer_paused = False
        self.timer_thread = None
        self.timer_seconds = 10  # Standard: 10 Sekunden
        
        # Erstelle GUI
        self.create_gui()
        
        # Lösche gespeicherte Ergebnisse nach der GUI-Erstellung
        self.clear_results_on_start()
        
    def load_results(self):
        """Lade gespeicherte Ergebnisse aus Datei"""
        if os.path.exists(self.results_file):
            try:
                with open(self.results_file, 'r') as f:
                    data = json.load(f)
                    self.used_results = set(data.get('used_results', []))
            except:
                self.used_results = set()
        else:
            self.used_results = set()
    
    def save_results(self):
        """Speichere Ergebnisse in Datei"""
        data = {
            'used_results': list(self.used_results),
            'last_updated': datetime.now().isoformat()
        }
        with open(self.results_file, 'w') as f:
            json.dump(data, f, indent=2)
    
    def create_gui(self):
        """Erstelle die Haupt-GUI"""
        # Notebook für Tabs
        self.notebook = ttk.Notebook(self.root)
        self.notebook.pack(fill='both', expand=True, padx=10, pady=10)
        
        # Tab 1: Aufgaben Generator
        self.create_task_tab()
        
        # Tab 2: Bingo Raster
        self.create_bingo_tab()
    
    def create_task_tab(self):
        """Erstelle den Aufgaben-Generator Tab"""
        task_frame = ttk.Frame(self.notebook)
        self.notebook.add(task_frame, text="Aufgaben Generator")
        
        # Titel
        title_label = ttk.Label(task_frame, text="Mathe Bingo Aufgaben Generator", 
                               font=('Arial', 16, 'bold'))
        title_label.pack(pady=20)
        
        # Aufgaben Anzeige
        self.task_display = tk.Text(task_frame, height=8, width=50, 
                                   font=('Arial', 24), state='disabled')
        self.task_display.pack(pady=20)
        
        # Button Frame
        button_frame = ttk.Frame(task_frame)
        button_frame.pack(pady=20)
        
        # Neue Aufgabe Button
        self.new_task_btn = ttk.Button(button_frame, text="Neue Aufgabe generieren", 
                                      command=self.generate_new_task)
        self.new_task_btn.pack(side='left', padx=10)
        
        # Ergebnisse löschen Button
        clear_btn = ttk.Button(button_frame, text="Alle Ergebnisse löschen", 
                              command=self.clear_all_results)
        clear_btn.pack(side='left', padx=10)
        
        # Timer Frame
        timer_frame = ttk.LabelFrame(task_frame, text="Timer-Modus")
        timer_frame.pack(pady=20, padx=20, fill='x')
        
        # Zeitspanne Auswahl
        time_frame = ttk.Frame(timer_frame)
        time_frame.pack(pady=10)
        
        ttk.Label(time_frame, text="Zeitspanne (Sekunden):").pack(side='left', padx=5)
        
        self.time_var = tk.StringVar(value="10")
        time_spinbox = ttk.Spinbox(time_frame, from_=1, to=60, width=10, 
                                  textvariable=self.time_var, command=self.update_timer_seconds)
        time_spinbox.pack(side='left', padx=5)
        
        # Timer Buttons
        timer_btn_frame = ttk.Frame(timer_frame)
        timer_btn_frame.pack(pady=10)
        
        self.start_timer_btn = ttk.Button(timer_btn_frame, text="Timer starten", 
                                         command=self.start_timer)
        self.start_timer_btn.pack(side='left', padx=5)
        
        self.stop_timer_btn = ttk.Button(timer_btn_frame, text="Timer stoppen", 
                                        command=self.stop_timer, state='disabled')
        self.stop_timer_btn.pack(side='left', padx=5)
        
        self.pause_timer_btn = ttk.Button(timer_btn_frame, text="Pause", 
                                         command=self.pause_timer, state='disabled')
        self.pause_timer_btn.pack(side='left', padx=5)
        
        # Timer Status
        self.timer_status_label = ttk.Label(timer_frame, text="Timer bereit", 
                                           font=('Arial', 10))
        self.timer_status_label.pack(pady=5)
        
        # Status Label
        self.status_label = ttk.Label(task_frame, text="Bereit für neue Aufgabe", 
                                     font=('Arial', 10))
        self.status_label.pack(pady=10)
        
        # Statistiken
        stats_frame = ttk.LabelFrame(task_frame, text="Statistiken")
        stats_frame.pack(pady=20, padx=20, fill='x')
        
        self.stats_label = ttk.Label(stats_frame, 
                                    text=f"Verwendete Ergebnisse: {len(self.used_results)}/100")
        self.stats_label.pack(pady=10)
    
    def create_bingo_tab(self):
        """Erstelle den Bingo Raster Tab"""
        bingo_frame = ttk.Frame(self.notebook)
        self.notebook.add(bingo_frame, text="Bingo Raster")
        
        # Titel
        title_label = ttk.Label(bingo_frame, text="Bingo Raster (1-100)", 
                               font=('Arial', 16, 'bold'))
        title_label.pack(pady=20)
        
        # Scrollbar Frame für das Raster
        canvas_frame = ttk.Frame(bingo_frame)
        canvas_frame.pack(fill='both', expand=True, padx=20, pady=20)
        
        # Canvas mit Scrollbar
        self.canvas = tk.Canvas(canvas_frame)
        scrollbar = ttk.Scrollbar(canvas_frame, orient="vertical", command=self.canvas.yview)
        self.scrollable_frame = ttk.Frame(self.canvas)
        
        self.scrollable_frame.bind(
            "<Configure>",
            lambda e: self.canvas.configure(scrollregion=self.canvas.bbox("all"))
        )
        
        self.canvas.create_window((0, 0), window=self.scrollable_frame, anchor="nw")
        self.canvas.configure(yscrollcommand=scrollbar.set)
        
        self.canvas.pack(side="left", fill="both", expand=True)
        scrollbar.pack(side="right", fill="y")
        
        # Erstelle das Bingo Raster
        self.create_bingo_grid()
        
        # Refresh Button
        refresh_btn = ttk.Button(bingo_frame, text="Raster aktualisieren", 
                                command=self.refresh_bingo_grid)
        refresh_btn.pack(pady=10)
    
    def create_bingo_grid(self):
        """Erstelle das Bingo Raster mit Zahlen 1-100"""
        # Lösche alte Widgets
        for widget in self.scrollable_frame.winfo_children():
            widget.destroy()
        
        # Setze helleren Hintergrund für das gesamte Raster
        self.scrollable_frame.configure(style='Light.TFrame')
        
        # Erstelle 10x10 Raster
        for i in range(10):
            for j in range(10):
                number = i * 10 + j + 1
                frame = ttk.Frame(self.scrollable_frame, relief='solid', borderwidth=1)
                frame.grid(row=i, column=j, sticky='nsew', padx=1, pady=1)
                
                # Prüfe ob die Zahl verwendet wurde
                if number in self.used_results:
                    label = ttk.Label(frame, text=str(number), 
                                     background='#32CD32',  # Lime Green
                                     foreground='white',
                                     font=('Arial', 12, 'bold'))
                else:
                    label = ttk.Label(frame, text=str(number), 
                                     background='#F0F8FF',  # Alice Blue (heller Hintergrund)
                                     foreground='black',
                                     font=('Arial', 12))
                
                label.pack(expand=True, fill='both', padx=2, pady=2)
        
        # Konfiguriere Grid Gewichtung
        for i in range(10):
            self.scrollable_frame.grid_columnconfigure(i, weight=1)
            self.scrollable_frame.grid_rowconfigure(i, weight=1)
    
    def generate_new_task(self):
        """Generiere eine neue Aufgabe"""
        max_attempts = 1000
        attempts = 0
        
        while attempts < max_attempts:
            # Generiere Zufallszahlen
            a = random.randint(1, 10)
            b = random.randint(1, 100)
            z = a * b
            
            # Berechne das finale Ergebnis (a × b + e oder a × b - e)
            if z < 100:
                d = 100 - z
                e = random.randint(1, d)
                final_result = a * b + e  # a × b + e
                operation = "+"
            else:
                d = z - 100
                e = random.randint(d, z - 1)
                final_result = a * b - e  # a × b - e
                operation = "-"
            
            # Prüfe ob das finale Ergebnis noch nicht verwendet wurde
            if final_result not in self.used_results and 1 <= final_result <= 100:
                self.current_task = {
                    'a': a,
                    'b': b,
                    'e': e,
                    'operation': operation,
                    'final_result': final_result,
                    'd': d
                }
                
                # Zeige Aufgabe an
                self.display_task()
                
                # Markiere das finale Ergebnis als verwendet
                self.used_results.add(final_result)
                self.save_results()
                
                # Aktualisiere Statistiken
                self.update_stats()
                
                # Aktualisiere das Bingo Raster automatisch
                self.refresh_bingo_grid()
                
                return
            
            attempts += 1
        
        # Wenn keine neue Aufgabe gefunden wurde
        messagebox.showwarning("Warnung", 
                              "Alle möglichen Ergebnisse wurden bereits verwendet!\n"
                              "Lösche alle Ergebnisse um fortzufahren.")
    
    def display_task(self):
        """Zeige die aktuelle Aufgabe an"""
        if not self.current_task:
            return
        
        task_text = f"""Neue Matheaufgabe:

{self.current_task['a']} × {self.current_task['b']} {self.current_task['operation']} {self.current_task['e']} = ?

Berechne das Ergebnis und markiere es in deinem Bingo-Raster.
"""
        
        self.task_display.config(state='normal')
        self.task_display.delete(1.0, tk.END)
        self.task_display.insert(1.0, task_text)
        self.task_display.config(state='disabled')
        
        self.status_label.config(text="Neue Aufgabe generiert - Ergebnis versteckt")
    
    def update_stats(self):
        """Aktualisiere die Statistiken"""
        self.stats_label.config(text=f"Verwendete Ergebnisse: {len(self.used_results)}/100")
    
    def clear_all_results(self):
        """Lösche alle gespeicherten Ergebnisse"""
        if messagebox.askyesno("Bestätigung", 
                              "Möchtest du wirklich alle Ergebnisse löschen?"):
            self.used_results.clear()
            self.save_results()
            self.update_stats()
            self.refresh_bingo_grid()
            self.status_label.config(text="Alle Ergebnisse gelöscht")
    
    def refresh_bingo_grid(self):
        """Aktualisiere das Bingo Raster"""
        self.create_bingo_grid()

    def clear_results_on_start(self):
        """Lösche gespeicherte Ergebnisse beim Start"""
        self.used_results.clear()
        self.save_results()
        # Warte bis GUI vollständig erstellt ist
        self.root.after(100, self.update_stats)
        self.root.after(200, self.refresh_bingo_grid)

    def start_timer(self):
        """Starte den Timer"""
        try:
            self.timer_seconds = int(self.time_var.get())
            if self.timer_seconds < 1 or self.timer_seconds > 60:
                messagebox.showerror("Fehler", "Zeitspanne muss zwischen 1 und 60 Sekunden liegen!")
                return
        except ValueError:
            messagebox.showerror("Fehler", "Bitte geben Sie eine gültige Zahl ein!")
            return
            
        self.timer_running = True
        self.timer_paused = False
        self.timer_thread = threading.Thread(target=self.timer_thread_func, daemon=True)
        self.timer_thread.start()
        self.start_timer_btn.config(state='disabled')
        self.stop_timer_btn.config(state='normal')
        self.pause_timer_btn.config(state='normal')
        self.timer_status_label.config(text=f"Timer läuft - {self.timer_seconds} Sekunden")
    
    def stop_timer(self):
        """Stoppe den Timer"""
        self.timer_running = False
        self.timer_paused = False
        self.timer_thread = None
        self.start_timer_btn.config(state='normal')
        self.stop_timer_btn.config(state='disabled')
        self.pause_timer_btn.config(state='disabled')
        self.timer_status_label.config(text="Timer gestoppt")
    
    def pause_timer(self):
        """Pausiere den Timer"""
        if self.timer_running:
            self.timer_paused = True
            self.start_timer_btn.config(text="Weiter", command=self.resume_timer)
            self.stop_timer_btn.config(state='normal')
            self.pause_timer_btn.config(state='disabled')
            self.timer_status_label.config(text="Timer pausiert")
    
    def resume_timer(self):
        """Setze den Timer fort"""
        self.timer_paused = False
        self.timer_running = True
        self.start_timer_btn.config(text="Timer starten", command=self.start_timer, state='disabled')
        self.stop_timer_btn.config(state='normal')
        self.pause_timer_btn.config(state='normal')
        self.timer_status_label.config(text=f"Timer läuft - {self.timer_seconds} Sekunden")
    
    def timer_thread_func(self):
        """Funktion für den Timer Thread"""
        while self.timer_running:
            if not self.timer_paused:
                time.sleep(1)
                self.timer_seconds -= 1
                
                # GUI Update im Hauptthread
                self.root.after(0, self.update_timer_display)
                
                if self.timer_seconds <= 0:
                    # Timer abgelaufen - neue Aufgabe generieren
                    self.root.after(0, self.timer_finished)
                    break
            else:
                time.sleep(0.1)
    
    def update_timer_display(self):
        """Aktualisiere die Timer-Anzeige"""
        if self.timer_running and not self.timer_paused:
            self.timer_status_label.config(text=f"Timer läuft - {self.timer_seconds} Sekunden")
    
    def timer_finished(self):
        """Timer ist abgelaufen - generiere neue Aufgabe"""
        self.generate_new_task()
        # Timer zurücksetzen und neu starten
        try:
            self.timer_seconds = int(self.time_var.get())
            if self.timer_running:
                self.timer_thread = threading.Thread(target=self.timer_thread_func, daemon=True)
                self.timer_thread.start()
        except ValueError:
            self.stop_timer()
    
    def update_timer_seconds(self):
        """Aktualisiere die Timer-Zeitspanne"""
        try:
            self.timer_seconds = int(self.time_var.get())
        except ValueError:
            pass

def main():
    root = tk.Tk()
    app = MatheBingoGUI(root)
    root.mainloop()

if __name__ == "__main__":
    main() 